//CONFIGURAÇÕES E VARIÁVEIS GERAIS-------------------------------------------------------------

//Câmeras
const NOMES_CAMERAS= ['Cozinha', 'Entrada', 'Escada', 'Quarto', 'Sala'];

// Tempo para o vigilante poder fugir (trocar de camera) 
const TEMPO_PARA_FUGIR= 0;

// Minutos para esperar o 2º jogador as mais antigas que isso são abandonadas
const MINUTOS_DE_ESPERA = 5;

//Banco de dados
const banco= supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Dados da partida atual
let idPartida = null;
let idJogador = null;
let jogoEncerrado = false;
let temporizador= null
let cameras = [];  

// Painel do monstro
let monstroSala = null;         
let monstroAtivadoEm = null;    
let vigilanteSala = null;       
let partidaEmAndamento = false;

// Câmera do vigilante
let minhaCamera = null; 
let cicloVigilanteOcupado = false;         

// Sala de espera
let intervaloDaEspera = null;   
let esperaIdPartida = null;     

//A câmera do vigilante pergunta ao banco se o monstro apareceu
const INTERVALO_VIGILANTE = 200;

// Tempo máximo (em milissegundos) que o jogo espera o susto terminar antes de mostrar o resultado
const TEMPO_MAXIMO_DO_SUSTO = 8000;

//IDENTIFICAÇÃO DO JOGADOR----------------------------------------------------------------

// Código único para identificar o jogador
function getToken() {
    let token = sessionStorage.getItem('session_token');
    if (token === null) {
        token = crypto.randomUUID();
        sessionStorage.setItem('session_token', token);
    }
    return token;
}

// lê os dados da partida que foram salvos no navegador
function lerPartidaSalva() {
    const idPartidaSalvo = sessionStorage.getItem('match_id');
    const idJogadorSalvo = sessionStorage.getItem('player_id');
    const papelSalvo = sessionStorage.getItem('role');

    // Sem patida 
    if (idPartidaSalvo === null || idJogadorSalvo === null || papelSalvo === null) {
        return null;
    }


return {
    idPartida: Number(idPartidaSalvo),
    idJogador: Number(idJogadorSalvo),
    papel: papelSalvo
};
}

// Papel do jogador
function irParaPagina(idDaPartida, idDoJogador, papel) {
    sessionStorage.setItem('match_id', idDaPartida);
    sessionStorage.setItem('player_id', idDoJogador);
    sessionStorage.setItem('role', papel);

    if (papel === 'monster') {
        location.href = 'painel_monstro.html';  
    } else {
        location.href = 'cam_sala.html';       
    }
}

// GERENCIAMENTO DAS CÂMERAS NO BANCO DE DADOS----------------------------------------------

// Verifica quais câmeras já existem e cadastra as que estão faltando
async function garantirSalasDasCameras() {

    const resposta = await banco.from('rooms').select('name').in('name', NOMES_CAMERAS);
    if (resposta.error) throw resposta.error;

    const salasNovas = [];
    for (let i = 0; i < NOMES_CAMERAS.length; i++) {
        const nome = NOMES_CAMERAS[i];

        let jaExiste = false;
        for (let j = 0; j < resposta.data.length; j++) {
            if (resposta.data[j].name === nome) {
                jaExiste = true;
            }
        }

        if (jaExiste === false) {
            salasNovas.push({ name: nome, description: 'Câmera ' + nome });
        }
    }

    // Cadastra todas as câmeras que estão faltando
    if (salasNovas.length > 0) {
        const criacao = await banco.from('rooms').insert(salasNovas);
        if (criacao.error) throw criacao.error;
    }
}

// Busca no banco as câmeras e devolve uma lista na ordem de NOMES_CAMERAS
async function carregarCameras() {
    // Já buscou nesta aba? Usa a lista guardada: evita uma ida ao banco a cada troca de câmera
    const guardado = sessionStorage.getItem('cameras_cache');
    if (guardado !== null) {
        const listaGuardada = JSON.parse(guardado);
        if (listaGuardada.length === NOMES_CAMERAS.length) {
            return listaGuardada;
        }
    }

    const resposta = await banco.from('rooms').select('id, name').in('name', NOMES_CAMERAS).order('id');
    if (resposta.error) throw resposta.error;

    const todas = resposta.data;
    const lista = [];

    for (let i = 0; i < NOMES_CAMERAS.length; i++) {
        for (let j = 0; j < todas.length; j++) {
            if (todas[j].name === NOMES_CAMERAS[i]) {
                lista.push(todas[j]);
                break;
            }
        }
    }
    if (lista.length === NOMES_CAMERAS.length) {
        sessionStorage.setItem('cameras_cache', JSON.stringify(lista));
    }
    return lista;
}

// Localiza uma câmera pelo seu ID
function acharCameraPorId(listaDeCameras, id) {
    for (let i = 0; i < listaDeCameras.length; i++) {
        if (listaDeCameras[i].id === id) {
            return listaDeCameras[i];
        }
    }
    return null;
}

//SALA DE ESPERA-------------------------------------------------------------------

// Escreve um texto na mensagem da sala de espera e mostra ela na tela
function mostrarMensagemDeEspera(texto) {
    const mensagem = document.getElementById('mensagem-espera');
    if (mensagem !== null) {
        mensagem.textContent = texto;
        mensagem.classList.remove('escondida');
    }
}

// Volta a sala de espera ao começo: botão liberado e mensagem escondida
function reiniciarSalaDeEspera() {
    clearInterval(intervaloDaEspera);
    esperaIdPartida = null;
    pararSons();

    const botao = document.getElementById('btn-sala-espera');
    if (botao !== null) {
        botao.disabled = false;
    }
    const mensagem = document.getElementById('mensagem-espera');
    if (mensagem !== null) {
        mensagem.classList.add('escondida');
    }
}


// Fica esperando o outro jogador: a cada 2 segundos pergunta ao banco se a partida já começou
function esperarOutroJogador(idDaPartida, idDoJogador, meuPapel) {
    esperaIdPartida = idDaPartida;
    mostrarMensagemDeEspera('Aguardando jogadores se conectar...');
    
    // Tenta tocar a música de espera de forma segura caso o navegador bloqueie o autoplay inicial
    try {
        tocarSom('espera');   // música da sala de espera
    } catch (e) {
        console.warn('Aguardando interação para tocar o som de espera.', e);
    }

    clearInterval(intervaloDaEspera);
    intervaloDaEspera = setInterval(async function () {
        const resposta = await banco.from('matches').select('status').eq('id', idDaPartida).single();
        if (resposta.error) {
            console.error(resposta.error);
            return;
        }

        if (resposta.data.status === 'in_progress') {
            // O outro jogador chegou: vai para a página do meu papel
            clearInterval(intervaloDaEspera);
            esperaIdPartida = null;
            irParaPagina(idDaPartida, idDoJogador, meuPapel);
        } else if (resposta.data.status === 'finished') {
            alert('A partida foi cancelada. Tente entrar de novo.');
            reiniciarSalaDeEspera();
        }
    }, 2000);
}
// Chamada pelo botão "Sala de Espera"
async function entrarSalaEspera() {
    const botao = document.getElementById('btn-sala-espera');
    if (botao !== null) {
        botao.disabled = true;   // evita clicar duas vezes
        tocarSom('espera');   // tem que ser no clique, antes de qualquer await
    }
    mostrarMensagemDeEspera('Procurando partida...');
    sessionStorage.removeItem('cameras_cache');
    sessionStorage.removeItem('monstro_visto');
    try {
        await garantirSalasDasCameras();
        const token = getToken();

        // Até 3 tentativas: se dois jogadores entrarem no mesmo instante, um deles tenta de novo
        for (let tentativa = 0; tentativa < 3; tentativa++) {

            // ----- 1: procurar uma partida esperando -----
            const limite = new Date(Date.now() - MINUTOS_DE_ESPERA * 60 * 1000).toISOString();
            const busca = await banco
                .from('matches')
                .select('id')
                .eq('status', 'waiting_players')
                .gte('created_at', limite)
                .order('id', { ascending: true })
                .limit(1);
            if (busca.error) throw busca.error;

            let idDaPartida = null;
            let meuPapel = '';
            let souOSegundoJogador = false;

            if (busca.data.length > 0) {
                // Achei uma partida esperando
                idDaPartida = busca.data[0].id;

                const jogadores = await banco
                    .from('match_players')
                    .select('id, role, session_token')
                    .eq('match_id', idDaPartida);
                if (jogadores.error) throw jogadores.error;

                // Se um deles sou EU (atualizei a página), volto a esperar
                for (let i = 0; i < jogadores.data.length; i++) {
                    if (jogadores.data[i].session_token === token) {
                        esperarOutroJogador(idDaPartida, jogadores.data[i].id, jogadores.data[i].role);
                        return;
                    }
                }

                // Fico com o papel que SOBROU: se o outro é monstro, eu sou vigilante (e vice-versa)
                meuPapel = 'monster';
                if (jogadores.data.length > 0 && jogadores.data[0].role === 'monster') {
                    meuPapel = 'survivor';
                }
                souOSegundoJogador = true;

            } else {
                // Não achei: crio uma partida nova
                const config = await banco
                    .from('game_configs')
                    .select('value_numeric')
                    .eq('key', 'match_duration_seconds')
                    .maybeSingle();

                let duracao = 300;
                if (config.data !== null && config.data.value_numeric) {
                    duracao = config.data.value_numeric;
                }

                const novaPartida = await banco
                    .from('matches')
                    .insert({ duration_limit_seconds: duracao })
                    .select('id')
                    .single();
                if (novaPartida.error) throw novaPartida.error;
                idDaPartida = novaPartida.data.id;

                // Papel SORTEADO
                meuPapel = 'survivor';
                if (Math.random() < 0.5) {
                    meuPapel = 'monster';
                }
            }

            // ----- 2: entrar na partida com o meu papel -----
            const novoJogador = await banco
                .from('match_players')
                .insert({ match_id: idDaPartida, session_token: token, role: meuPapel })
                .select('id')
                .single();

            if (novoJogador.error) {
                if (novoJogador.error.code === '23505') {
                    continue;   
                }
                throw novoJogador.error;
            }

            // -----3: começar ou esperar -----
            if (souOSegundoJogador === true) {
                // Sou o 2º jogador: a partida começa agora
                const inicio = await banco
                    .from('matches')
                    .update({ status: 'in_progress', started_at: new Date().toISOString() })
                    .eq('id', idDaPartida);
                if (inicio.error) throw inicio.error;

                irParaPagina(idDaPartida, novoJogador.data.id, meuPapel);
            } else {
                // Criei a partida: espero o outro jogador chegar
                esperarOutroJogador(idDaPartida, novoJogador.data.id, meuPapel);
            }
            return;
        }

        throw new Error('Não foi possível entrar na partida agora. Tente de novo.');

    } catch (erro) {
        console.error(erro);
        alert(erro.message);
        reiniciarSalaDeEspera();
    }
}

// Se eu criei uma partida e fechei a página antes de alguém entrar, cancela essa partida.
window.addEventListener('pagehide', function () {
    if (esperaIdPartida !== null) {
        banco
            .from('matches')
            .update({ status: 'finished', winner: 'none', finish_reason: 'canceled', ended_at: new Date().toISOString() })
            .eq('id', esperaIdPartida)
            .eq('status', 'waiting_players')
            .then(function () {});  
    }
});

// Relogio e fim de jogo---------------------------------------------

// Converte o tempo em minutos e segundos
function formatarTempo(segundos) {
    if (segundos < 0) {
        segundos = 0;
    }
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    return String(minutos).padStart(2, '0') + ':' + String(resto).padStart(2, '0');
}

// Calcula quanto tempo falta para a partida terminar
function segundosRestantes(partida) {
    if (partida.started_at === null) {
        return null;
    }
    const horaDoInicio = new Date(partida.started_at).getTime();
    const horaDoFim = horaDoInicio + partida.duration_limit_seconds * 1000;
    return Math.ceil((horaDoFim - Date.now()) / 1000);
}

// Atualiza o tempo exibido na tela
function atualizarRelogio(partida) {
    const elemento = document.getElementById('tempo');
    if (elemento === null) {
        return;
    }

    const restante = segundosRestantes(partida);
    if (restante === null) {
        elemento.textContent = 'Aguardando o outro jogador...';
    } else {
        elemento.textContent = formatarTempo(restante);
    }
}

// Busca os dados da partida atual no banco de dados
async function buscarPartida() {
    const resposta = await banco.from('matches').select('*').eq('id', idPartida).single();
    if (resposta.error) {
        console.error(resposta.error);
        return null;
    }
    return resposta.data;
}

// Salva o resultado da partida no banco de dados.
async function terminarPartida(vencedor, motivo) {
    const resposta = await banco
        .from('matches')
        .update({
            status: 'finished',
            winner: vencedor,
            finish_reason: motivo,
            ended_at: new Date().toISOString()
        })
        .eq('id', idPartida)
        .eq('status', 'in_progress');
    if (resposta.error) throw resposta.error;
}

// Mostra o resultado
function terminarEVoltarAoLobby(mensagem) {
    alert(mensagem);
    sessionStorage.removeItem('match_id');
    sessionStorage.removeItem('player_id');
    sessionStorage.removeItem('role');
    sessionStorage.removeItem('cameras_cache');
    sessionStorage.removeItem('monstro_visto');
    location.href = 'painel_modo.html';
}


// Tela de fim de jogo (vitória ou derrota)
async function mostrarFim(partida, papel) {
    if (jogoEncerrado === true) {
        return;
    }

    jogoEncerrado = true;
    clearInterval(temporizador);
    pararSons();   // o susto não toca por cima dos outros sons

    // Jumpscare aparece somente na tela do vigilante quando ele morre
    if (papel === 'survivor' && partida.finish_reason === 'killed' && typeof Jumpscare !== 'undefined') {
        await Jumpscare.play();
    }

    let venceu = false;
    if (partida.winner === papel) {
        venceu = true;
    }

    let motivo = 'Partida encerrada.';

    if (partida.finish_reason === 'killed') {
        if (papel === 'monster') {
            motivo = 'Você pulou na câmera do vigilante!';
        } else {
            motivo = 'O monstro pulou na sua câmera!';
        }
    } else if (partida.finish_reason === 'time_out') {
        if (papel === 'survivor') {
            motivo = 'O tempo acabou e você sobreviveu!';
        } else {
            motivo = 'O tempo acabou e o vigilante sobreviveu.';
        }
    }

    let titulo = '💀 VOCÊ PERDEU!\n';

    if (venceu === true) {
        titulo = '🏆 VOCÊ VENCEU!\n';
    }

    const mensagem = titulo + motivo;

    terminarEVoltarAoLobby(mensagem);
}


// Verifica o andamento da partida e atualiza o relógio.
async function conferirPartida(papel) {
    const partida = await buscarPartida();
    if (partida === null) {
        return null;
    }

    if (partida.status === 'finished') {
        mostrarFim(partida, papel);
        return null;
    }

    atualizarRelogio(partida);

    // O vigilante verifica se o tempo da partida acabou.
    if (partida.status === 'in_progress' && papel === 'survivor') {
        const restante = segundosRestantes(partida);
        if (restante !== null && restante <= 0) {
            // vitória do vigilante.
            await terminarPartida('survivor', 'time_out');
            const partidaFinal = await buscarPartida();
            if (partidaFinal !== null && partidaFinal.status === 'finished') {
                mostrarFim(partidaFinal, papel);
            }
            return null;
        }
    }

    return partida;
}

//MONSTRO (painel)---------------------------------------------------

// Entra como monsto
async function iniciarMonstro() {
    const jogo = lerPartidaSalva();
    if (jogo === null || jogo.papel !== 'monster') {
        location.href = 'painel_modo.html';
        return;
    }
    idPartida = jogo.idPartida;
    idJogador = jogo.idJogador;

    prepararSons(['painel']);
    tocarSom('painel');

    cameras = await carregarCameras();

    // Lê no banco se o monstro já estava ativo em alguma câmera (ex.: se atualizei a página)
    const resposta = await banco.from('match_players').select('current_room_id').eq('id', idJogador).single();
    if (resposta.error) throw resposta.error;
    monstroSala = resposta.data.current_room_id;
    if (monstroSala !== null) {
        monstroAtivadoEm = Date.now();
    }

    desenharControlesMonstro();
    atualizarTelaDoMonstro();

  
    cicloDoMonstro();
    temporizador = setInterval(cicloDoMonstro, 1000);
}

// Página monstro detalhes
function desenharControlesMonstro() {
    let opcoes = '';
    for (let i = 0; i < cameras.length; i++) {
        opcoes = opcoes + '<option value="' + cameras[i].id + '">' + cameras[i].name + '</option>';
    }

    // Adiciona os botões e as informações do painel.
    document.getElementById('controles-bichos').innerHTML =
        '<p><strong>Monstro</strong> ' +
        '<select id="sala-bicho">' + opcoes + '</select> ' +
        '<button onclick="ativarMonstro()">Ativar</button> ' +
        '<button onclick="desativarMonstro()">Desativar</button></p>' +
        '<p id="estado-monstro"></p>' +
        '<p id="estado-vigilante"></p>' + 
        '<p><button id="btn-matar" onclick="matarVigilante()" disabled>Pular na câmera do vigilante</button></p>';
}

// Atualiza as informações dos jogadores e o botão de ataque.
function atualizarTelaDoMonstro() {
    const cameraDoMonstro = acharCameraPorId(cameras, monstroSala);

    // Mostra em qual câmera o monstro está.
    if (cameraDoMonstro !== null) {
        document.getElementById('estado-monstro').textContent = 'Monstro = Ativo na câmera ' + cameraDoMonstro.name;
    } else {
        document.getElementById('estado-monstro').textContent = 'Monstro = Desativado';
    }

    // O status do vigilante foi completamente ocultado do painel do monstro.

    // Como o monstro não sabe onde o vigilante está, a condição para pular 
    // passa a exigir apenas que o monstro esteja ativo e o tempo de espera tenha passado.s
    let esperouOTempo = false;
    if (monstroAtivadoEm !== null) {
        const milissegundosPassados = Date.now() - monstroAtivadoEm;
        if (milissegundosPassados >= TEMPO_PARA_FUGIR * 1000) {
            esperouOTempo = true;
        }
    }

    const botaoPular = document.getElementById('btn-matar');
    if (partidaEmAndamento === true && monstroSala !== null && esperouOTempo === true) {
        botaoPular.disabled = false;
    } else {
        botaoPular.disabled = true;
    }
}

// Verifica o estado da partida sem rastrear a posição do vigilante
async function cicloDoMonstro() {
    if (jogoEncerrado === true) {
        return;
    }

    try {
        const partida = await conferirPartida('monster');
        if (partida === null) {
            return;
        }
        partidaEmAndamento = (partida.status === 'in_progress');

        // O monstro NÃO descobre onde o vigilante está. Deixamos vigilanteSala como null 
        // para que o monstro precise adivinhar a câmera por tentativa e erro ou áudio.
        vigilanteSala = null;

        atualizarTelaDoMonstro();

    } catch (erro) {
        console.error(erro);
    }
}

// Ativa o monstro na câmera selecionada
function ativarMonstro() {
    const salaEscolhida = Number(document.getElementById('sala-bicho').value);
    moverMonstro(salaEscolhida);
}

// Desativa o monstro da câmera atual
function desativarMonstro() {
    moverMonstro(null);
}

// Atualiza a posição do monstro no banco de dados.
async function moverMonstro(salaId) {
    try {
        // Salva a câmera escolhida pelo monstro.
        const resposta = await banco
            .from('match_players')
            .update({ current_room_id: salaId, last_action_at: new Date().toISOString() })
            .eq('id', idJogador)
            .select('id, current_room_id');
        if (resposta.error) throw resposta.error;

        // Verifica se a alteração foi salva.
        if (resposta.data.length === 0) {
            throw new Error('O banco NÃO gravou a mudança (0 linhas alteradas). Pode ser bloqueio de permissão ' +
                '(RLS) no Supabase, ou este jogador não existe mais no banco. Volte ao lobby e entre de novo.');
        }

        // Registra a movimentação no histórico da partida.
        const camera = acharCameraPorId(cameras, salaId);
        let detalhes = 'Monstro desativado';
        if (camera !== null) {
            detalhes = 'Monstro ativado na câmera ' + camera.name;
        }
        const historico = await banco.from('match_events').insert({
            match_id: idPartida,
            player_id: idJogador,
            event_type: 'move',
            details: detalhes
        });
        if (historico.error) {
            console.warn('Não gravou o histórico:', historico.error.message);
        }

        // Atualiza a posição do monstro na tela.
        monstroSala = resposta.data[0].current_room_id;
        if (monstroSala === null) {
            monstroAtivadoEm = null;
        } else {
            monstroAtivadoEm = Date.now();
        }
        atualizarTelaDoMonstro();

    } catch (erro) {
        console.error(erro);
        alert(erro.message);
    }
}

// Realiza o ataque quando o vigilante continua na mesma câmera.
async function matarVigilante() {
    try {
        // Confere novamente a posição do vigilante antes do ataque.
        const resposta = await banco
            .from('match_players')
            .select('current_room_id')
            .eq('match_id', idPartida)
            .eq('role', 'survivor')
            .maybeSingle();

        let vigilanteAindaLa = false;
        if (resposta.data !== null && monstroSala !== null && resposta.data.current_room_id === monstroSala) {
            vigilanteAindaLa = true;
        }

       // não espera o histórico
banco.from('match_events').insert({
    match_id: idPartida,
    player_id: idJogador,
    event_type: 'kill_attempt',
    details: 'Monstro pulou na câmera do vigilante.'
});

await terminarPartida('monster', 'killed');
mostrarFim({ status: 'finished', winner: 'monster', finish_reason: 'killed' }, 'monster');

        // Registra o ataque no histórico da partida.
        await banco.from('match_events').insert({
            match_id: idPartida,
            player_id: idJogador,
            event_type: 'kill_attempt',
            details: 'Monstro pulou na câmera do vigilante.'
        });

        // Registra a vitória do monstro e encerra a partida.
        await terminarPartida('monster', 'killed');
        const partidaFinal = await buscarPartida();
        if (partidaFinal !== null && partidaFinal.status === 'finished') {
            mostrarFim(partidaFinal, 'monster');
        }
    } catch (erro) {
        console.error(erro);
        alert(erro.message);
    }
}

//VIGILANTE------------------------------------------------------------ 

// Roda uma vez quando a página de câmera abre
async function iniciarCamera() {
    // Confere se eu realmente entrei como vigilante
    const jogo = lerPartidaSalva();
    if (jogo === null || jogo.papel !== 'survivor') {
        location.href = 'painel_modo.html';
        return;
    }
    idPartida = jogo.idPartida;
    idJogador = jogo.idJogador;

    banco.channel('partida-' + idPartida)
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'id=eq.' + idPartida },
        function (payload) {
            if (payload.new.status === 'finished') {
                mostrarFim(payload.new, 'survivor');
            }
        })
    .subscribe();

    // Prepara o susto 
    if (typeof Jumpscare !== 'undefined') {
        Jumpscare.prepare();
        document.addEventListener('click', function () {
            Jumpscare.prepare();
        }, { once: true });   
    }

    // Descobre qual câmera é esta página 
    cameras = await carregarCameras();
    const nomeDestaPagina = document.body.dataset.sala;
    for (let i = 0; i < cameras.length; i++) {
        if (cameras[i].name === nomeDestaPagina) {
            minhaCamera = cameras[i];
        }
    }
    if (minhaCamera === null) {
        alert('A câmera "' + nomeDestaPagina + '" não existe no banco.');
        return;
    }

    // Prepara a tela: imagens prontas e, se der, já mostra o estado certo (sem esperar o banco)
    prepararSons(['ambiente', 'monstro']);
    prepararImagensDaCamera();
    usarUltimoEstadoConhecido();

    // Começa já a perguntar onde o monstro está, SEM esperar as gravações abaixo terminarem
    const gravacao = gravarMinhaCamera();
    cicloDoVigilante();
    temporizador = setInterval(cicloDoVigilante, INTERVALO_VIGILANTE);

    try {
        await gravacao;
    } catch (erro) {
        clearInterval(temporizador);
        throw erro;
    }
}

// Grava no banco que o vigilante está olhando esta câmera e anota no histórico
async function gravarMinhaCamera() {
    const resposta = await banco
        .from('match_players')
        .update({ current_room_id: minhaCamera.id, last_action_at: new Date().toISOString() })
        .eq('id', idJogador)
        .select('id');
    if (resposta.error) throw resposta.error;
    if (resposta.data.length === 0) {
        throw new Error('O banco NÃO gravou a câmera do vigilante (0 linhas alteradas). Pode ser bloqueio de ' +
            'permissão (RLS) no Supabase, ou este jogador não existe mais. Volte ao menu e entre de novo.');
    }

    await banco.from('match_events').insert({
        match_id: idPartida,
        player_id: idJogador,
        event_type: 'move',
        details: 'Vigilante olhando a câmera ' + minhaCamera.name
    });
}

// confere a partida e pergunta ao banco onde o monstro está
async function cicloDoVigilante() {
    if (jogoEncerrado === true) {
        return;
    }
    if (cicloVigilanteOcupado === true) {
        return;  
    }
    cicloVigilanteOcupado = true;

    try {
        const respostas = await Promise.all([
            conferirPartida('survivor'),
            banco
                .from('match_players')
                .select('current_room_id')
                .eq('match_id', idPartida)
                .eq('role', 'monster')
                .maybeSingle()
        ]);
        const partida = respostas[0];
        const resposta = respostas[1];

        if (partida === null) {
            return;
        }
        if (resposta.error) {
            console.error(resposta.error);
            return;
        }

        // O monstro está NESTA câmera?
        let monstroAqui = false;
        if (resposta.data !== null && resposta.data.current_room_id === minhaCamera.id) {
            monstroAqui = true;
        }
        desenharCamera(monstroAqui);
        // Guarda onde o monstro estava: a próxima câmera que abrir usa isso para não "piscar"
        let salaDoMonstro = null;
        if (resposta.data !== null) {
            salaDoMonstro = resposta.data.current_room_id;
        }
        sessionStorage.setItem('monstro_visto', JSON.stringify({ sala: salaDoMonstro, quando: Date.now() }));

    } catch (erro) {
        console.error(erro);
    } finally {
        cicloVigilanteOcupado = false;
    }
}

// Mostra na tela se o monstro está ou não nesta câmera
function desenharCamera(monstroAqui) {
    const imagemNormal = document.getElementById('img-normal');      
    const imagemMonstro = document.getElementById('img-monstro');    
    const alerta = document.getElementById('alerta-monstro');        
    const textoStatus = document.getElementById('monstro-status');  
    const caixa = document.getElementById('cor');                   

    // 1) Imagens: a classe "ativa" mostra e a classe "escondida" esconde (definidas no CSS)
    if (imagemNormal !== null && imagemMonstro !== null) {
        if (monstroAqui === true) {
            imagemNormal.classList.remove('ativa');
            imagemNormal.classList.add('escondida');
            imagemMonstro.classList.remove('escondida');
            imagemMonstro.classList.add('ativa');
        } else {
            imagemMonstro.classList.remove('ativa');
            imagemMonstro.classList.add('escondida');
            imagemNormal.classList.remove('escondida');
            imagemNormal.classList.add('ativa');
        }
    }

    // 2) Aviso no topo
    if (alerta !== null) {
        if (monstroAqui === true) {
            alerta.style.display = 'block';
        } else {
            alerta.style.display = 'none';
        }
    }

    // 3) Texto de status
    if (textoStatus !== null) {
        if (monstroAqui === true) {
            textoStatus.textContent = 'Monstro = Presente';
        } else {
            textoStatus.textContent = 'Monstro = Ausente';
        }
    }

    // 4) Classe "alerta" na tela da câmera (dá para estilizar no CSS)
    if (caixa !== null) {
        if (monstroAqui === true) {
            caixa.classList.add('alerta');
        } else {
            caixa.classList.remove('alerta');
        }
    }

    // 5) Agora a tela já mostra o estado certo: o CSS pode revelar a imagem (evita o "pisca")
    document.body.classList.add('pronto');

    // 6) Som: com o monstro na câmera toca o som de perigo; sem ele, o som ambiente
    if (monstroAqui === true) {
        tocarSom('monstro');
    } else {
        tocarSom('ambiente');
    }
}

// Deixa as duas imagens da câmera prontas, para a troca entre elas ser instantânea
function prepararImagensDaCamera() {
    const ids = ['img-normal', 'img-monstro'];
    for (let i = 0; i < ids.length; i++) {
        const imagem = document.getElementById(ids[i]);
        if (imagem !== null && typeof imagem.decode === 'function') {
            imagem.decode().catch(function () {});  
        }
    }
}

// A imagem certa já aparece na hora, sem esperar a resposta do banco
function usarUltimoEstadoConhecido() {
    try {
        const guardado = sessionStorage.getItem('monstro_visto');
        if (guardado === null) {
            return;
        }
        const visto = JSON.parse(guardado);
        if (Date.now() - visto.quando < 3000) {
            desenharCamera(visto.sala === minhaCamera.id);
        }
    } catch (erro) {
        console.error(erro);
    }
}

//SONS---------------------------------------------------------------------------------

const ARQUIVOS_DE_SOM = {
    espera:   'sons/espera.mp3',
    ambiente: 'sons/ambiente.mp3',
    monstro:  'sons/monstro.mp3',
    painel:   'sons/painel.mp3'    
};

// Volume de cada som 
const VOLUME_DOS_SONS = {
    espera:   0.5,
    ambiente: 0.7,
    monstro:  1,
    painel:   0.6
};

const sonsCriados = {};          
let somDesejado = null;         
let esperandoInteracao = false;  

// Devolve o áudio de um som, criando ele na primeira vez
function obterSom(nome) {
    if (sonsCriados[nome] === undefined) {
        const audio = new Audio(ARQUIVOS_DE_SOM[nome]);
        audio.loop = true;         
        audio.preload = 'auto';     
        audio.volume = VOLUME_DOS_SONS[nome];
        sonsCriados[nome] = audio;
    }
    return sonsCriados[nome];
}

// Começa a carregar os sons antes de precisar deles (para tocar na hora)
function prepararSons(nomes) {
    for (let i = 0; i < nomes.length; i++) {
        obterSom(nomes[i]);
    }
}

// Pede para tocar um som (e parar os outros
function tocarSom(nome) {
    if (somDesejado === nome) {
        return;
    }
    somDesejado = nome;
    aplicarSons();
}

// Para todos os sons
function pararSons() {
    somDesejado = null;
    aplicarSons();
}

function aplicarSons() {
    for (const nome in sonsCriados) {
        if (nome !== somDesejado) {
            sonsCriados[nome].pause();
        }
    }
    if (somDesejado === null) {
        return;
    }

    const audio = obterSom(somDesejado);
    restaurarPosicaoDoSom(somDesejado, audio);

    const promessa = audio.play();
    if (promessa !== undefined) {
        promessa.catch(function (erro) {
            // O navegador só deixa tocar som depois que a pessoa clica na página.
  
            if (erro.name === 'NotAllowedError') {
                aguardarInteracaoParaSom();
            } else {
                console.warn('Não foi possível tocar o som (o arquivo existe na pasta "sons"?):', erro.message);
            }
        });
    }
}

// Espera o primeiro clique, tecla ou toque na página e então tenta tocar de novo
function aguardarInteracaoParaSom() {
    if (esperandoInteracao === true) {
        return;
    }
    esperandoInteracao = true;

    const eventos = ['click', 'keydown', 'touchstart'];
    function liberar() {
        esperandoInteracao = false;
        for (let i = 0; i < eventos.length; i++) {
            document.removeEventListener(eventos[i], liberar);
        }
        aplicarSons();
    }
    for (let i = 0; i < eventos.length; i++) {
        document.addEventListener(eventos[i], liberar);
    }
}

// Para não "quebrar" o som, guarda em que ponto ele estava ao sair da página
window.addEventListener('pagehide', function () {
    if (somDesejado !== null && sonsCriados[somDesejado] !== undefined) {
        sessionStorage.setItem('som_posicao', JSON.stringify({
            nome: somDesejado,
            tempo: sonsCriados[somDesejado].currentTime,
            quando: Date.now()
        }));
    }
});

// e continua dali na página seguinte 
function restaurarPosicaoDoSom(nome, audio) {
    try {
        const guardado = sessionStorage.getItem('som_posicao');
        if (guardado === null) {
            return;
        }
        sessionStorage.removeItem('som_posicao');   // usa uma vez só
        const posicao = JSON.parse(guardado);
        if (posicao.nome === nome && Date.now() - posicao.quando < 5000) {
            audio.currentTime = posicao.tempo;
        }
    } catch (erro) {
        console.error(erro);
    }
    }



// inicio automatica da pagina----------------------------------------------------------

async function iniciarPagina() {
    const papelDaPagina = document.body.dataset.papel;   

    try {
        if (papelDaPagina === 'monstro') {
            await iniciarMonstro();
        }
        if (papelDaPagina === 'vigilante') {
            await iniciarCamera();
        }
    } catch (erro) {
        console.error(erro);
        alert('Erro: ' + erro.message);
    }
}

document.addEventListener('DOMContentLoaded', iniciarPagina);

//Codigo JAVASCRIPTN ADD POR EVELYN) 

//function entrarSalaEspera() {
 //   const mensagem = document.getElementById("mensagem-espera");
 //   mensagem.classList.remove("escondida");
//}