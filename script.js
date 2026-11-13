//Câmeras
const NOMES_CAMERAS= ['Cozinha', 'Entrada', 'Escada', 'Quarto', 'Sala'];

// Tempo para o vigilante poder fugir (trocar de camera) 
const TEMPO_PARA_FUGIR= 5;

//Banco de dados
const banco= supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


let idPartida = null;
let idJogador = null;
let jogoEncerrado = false;
let temporizador= null

// Código único para identificar o jogador
function getToken() {
    let token = sessionStorage.getItem('session_token');
    if (token === null) {
        token = crypto.randomUUID();
        sessionStorage.setItem('session_token', token);
    }
    return token;
}

// Recupera os dados da partida que foram salvos no navegador
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

// Gerenciamento das câmeas no banco de dados----------------------------------------------


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
    const resposta = await banco.from('rooms').select('id, name').in('name', NOMES_CAMERAS).order('id');
    if (resposta.error) throw resposta.error;

    const todas = resposta.data;
    const cameras = [];

    // Organiza as câmeras de acordo com os nomes definidos.
    for (let i = 0; i < NOMES_CAMERAS.length; i++) {
        for (let j = 0; j < todas.length; j++) {
            if (todas[j].name === NOMES_CAMERAS[i]) {
                cameras.push(todas[j]);
                break;
            }
        }
    }
    return cameras;
}

// Localiza uma câmera pelo seu ID.
function acharCameraPorId(listaDeCameras, id) {
    for (let i = 0; i < listaDeCameras.length; i++) {
        if (listaDeCameras[i].id === id) {
            return listaDeCameras[i];
        }
    }
    return null;
}

//Escolha de papel (monsto/vigilante----------------------------------------------------------------------

async function entrarComo(papel) {
    try {
        await garantirSalasDasCameras();   
        const token = getToken();          

        //  Procurar partida esperando
        // SÓ paa partida criada nos últimos 3 minutos (as mais antigas foram abandonadas).
        const tresMinutosAtras = new Date(Date.now() - 3 * 60 * 1000).toISOString();

        const busca = await banco
            .from('matches')                          
            .select('id')                              
            .eq('status', 'waiting_players')           
            .gte('created_at', tresMinutosAtras)       
            .order('id', { ascending: true })         
            .limit(1);                               
        if (busca.error) throw busca.error;

        let idDaPartida = null;
        let souOSegundoJogador = false;

        if (busca.data.length > 0) {
            // Entrada segundo jogador
            souOSegundoJogador = true;
            idDaPartida = busca.data[0].id;


            const euMesmo = await banco
                .from('match_players')
                .select('id, role')
                .eq('match_id', idDaPartida)
                .eq('session_token', token)
                .maybeSingle();

            if (euMesmo.data !== null) {
                irParaPagina(idDaPartida, euMesmo.data.id, euMesmo.data.role);
                return;
}
        } else {
            // Criar uma partida nova 

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
        }

        // Para entrar na partida com o papel escolhido
        const novoJogador = await banco
            .from('match_players')
            .insert({ match_id: idDaPartida, session_token: token, role: papel })
            .select('id')
            .single();

        if (novoJogador.error) {
            if (novoJogador.error.code === '23505') {
                throw new Error('Esse papel já foi escolhido por outro jogador. Escolha o outro papel.');
            }
            throw novoJogador.error;
        }

        // Segundo jogador para inicar partida 
        if (souOSegundoJogador === true) {
            const inicio = await banco
                .from('matches')
                .update({ status: 'in_progress', started_at: new Date().toISOString() })
                .eq('id', idDaPartida);
            if (inicio.error) throw inicio.error;
        }

        // Inicia- abindo página do papel escolhido
        irParaPagina(idDaPartida, novoJogador.data.id, papel);

    } catch (erro) {

        console.error(erro);
        alert(erro.message);
    }
}

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

// Busca os dados da partida atual no banco de dados.
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
    location.href = 'painel_modo.html';
}



async function mostrarFim(partida, papel) {
    if (jogoEncerrado === true) {
        return;
    }

    jogoEncerrado = true;
    clearInterval(temporizador);

    // Jumpscare aparece somente na tela do vigilante quando ele morre.
    if (papel === 'survivor' && partida.finish_reason === 'killed') {
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

//MONSTRO (painel  contrrols------------------------------------

// Variáveis utilizadas no painel do monstro.
let cameras = [];
let monstroSala = null;
let monstroAtivadoEm = null;
let vigilanteSala = null;
let partidaEmAndamento = false;

// Entra como monsto
async function iniciarMonstro() {
    const jogo = lerPartidaSalva();
    if (jogo === null || jogo.papel !== 'monster') {
        location.href = 'painel_modo.html';
        return;
    }
    idPartida = jogo.idPartida;
    idJogador = jogo.idJogador;

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
    const cameraDoVigilante = acharCameraPorId(cameras, vigilanteSala);

    // Mostra em qual câmera o monstro está.
    if (cameraDoMonstro !== null) {
        document.getElementById('estado-monstro').textContent = 'Monstro = Ativo na câmera ' + cameraDoMonstro.name;
    } else {
        document.getElementById('estado-monstro').textContent = 'Monstro = Desativado';
    }

    // Mostra qual câmera o vigilante está observando.
    if (cameraDoVigilante !== null) {
        document.getElementById('estado-vigilante').textContent = 'Vigilante = olhando a câmera ' + cameraDoVigilante.name;
    } else {
        document.getElementById('estado-vigilante').textContent = 'Vigilante = ainda não escolheu uma câmera';
    }

    // Verifica se os dois jogadores estão na mesma câmera.
    let mesmaCamera = false;
    if (monstroSala !== null && monstroSala === vigilanteSala) {
        mesmaCamera = true;
    }

    // Verifica se o tempo de espera do monstro já passou.
    let esperouOTempo = false;
    if (monstroAtivadoEm !== null) {
        const milissegundosPassados = Date.now() - monstroAtivadoEm;
        if (milissegundosPassados >= TEMPO_PARA_FUGIR * 1000) {
            esperouOTempo = true;
        }
    }

    // Libera o ataque somente quando todas as condições forem atendidas.
    const botaoPular = document.getElementById('btn-matar');
    if (partidaEmAndamento === true && mesmaCamera === true && esperouOTempo === true) {
        botaoPular.disabled = false;
    } else {
        botaoPular.disabled = true;
    }
}

// Verifica o estado da partida e a posição do vigilante.
async function cicloDoMonstro() {
    if (jogoEncerrado === true) {
        return;
    }

    try {
        // Atualiza as informações da partida.
        const partida = await conferirPartida('monster');
        if (partida === null) {
            return;
        }
        partidaEmAndamento = (partida.status === 'in_progress');

        // Busca no banco a câmera escolhida pelo vigilante.
        const resposta = await banco
            .from('match_players')
            .select('current_room_id')
            .eq('match_id', idPartida)
            .eq('role', 'survivor')
            .maybeSingle();

        if (resposta.data === null) {
            vigilanteSala = null;
        } else {
            vigilanteSala = resposta.data.current_room_id;
        }

        atualizarTelaDoMonstro();

    } catch (erro) {
        console.error(erro);
    }
}

// Ativa o monstro na câmera selecionada.
function ativarMonstro() {
    const salaEscolhida = Number(document.getElementById('sala-bicho').value);
    moverMonstro(salaEscolhida);
}

// Desativa o monstro da câmera atual.
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

        if (vigilanteAindaLa === false) {
            alert('O vigilante saiu dessa câmera. Ele fugiu!');
            return;
        }

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

//Vigilante visao

let minhaCamera = null;   

// Prepara a página de câmera. Roda uma vez, quando a página abre.
async function iniciarCamera() {
    // Confere se eu realmente entrei como vigilante
    const jogo = lerPartidaSalva();
    if (jogo === null || jogo.papel !== 'survivor') {
        location.href = 'painel_modo.html';
        return;
    }
    idPartida = jogo.idPartida;
    idJogador = jogo.idJogador;

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

    // Grava no banco que o vigilante está olhando esta câmera.
    const resposta = await banco
        .from('match_players')
        .update({ current_room_id: minhaCamera.id, last_action_at: new Date().toISOString() })
        .eq('id', idJogador)
        .select('id');
    if (resposta.error) throw resposta.error;
    if (resposta.data.length === 0) {
        throw new Error('O banco NÃO gravou a câmera do vigilante (0 linhas alteradas). Pode ser bloqueio de ' +
            'permissão (RLS) no Supabase, ou este jogador não existe mais. Volte ao lobby e entre de novo.');
    }

    // Anota no histórico da partida.
    await banco.from('match_events').insert({
        match_id: idPartida,
        player_id: idJogador,
        event_type: 'move',
        details: 'Vigilante olhando a câmera ' + minhaCamera.name
    });


    cicloDoVigilante();
    temporizador = setInterval(cicloDoVigilante, 1000);
}

//pergunta ao banco onde o monstro está.
async function cicloDoVigilante() {
    if (jogoEncerrado === true) {
        return;
    }

    try {
        // Confere se a partida acabou, atualiza o relógio e vê se o tempo acabou.
        const partida = await conferirPartida('survivor');
        if (partida === null) {
            return;
        }

        // Pergunta ao banco: em qual câmera o monstro está?
        const resposta = await banco
            .from('match_players')
            .select('current_room_id')
            .eq('match_id', idPartida)
            .eq('role', 'monster')
            .maybeSingle();
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


    } catch (erro) {
        console.error(erro);
    }
}

// Mostra na tela se o monstro está ou não nesta câmera
// Faz duas coisas: troca o texto do alerta e troca a IMAGEM de fundo da câmera
function desenharCamera(monstroAqui) {
    const caixa = document.getElementById('cor');            
    const fundo = document.getElementById('fundo-camera');      

    // 1) Alerta
    if (monstroAqui === true) {
        caixa.textContent = '⚠️ MONSTRO DETECTADO!';
        caixa.classList.add('alerta');      
    } else {
        caixa.textContent = 'Câmaras Operacionais';
        caixa.classList.remove('alerta');   
    }

    // 2) Imagem de fundo: troca entre a imagem SEM o bicho e a imagem COM o bicho
    if (fundo !== null) {                                  
        let imagemNova = fundo.dataset.imgSemBicho;          
        if (monstroAqui === true) {
            imagemNova = fundo.dataset.imgComBicho;          
        }

        // Só troca se for diferente da que já está na tela (assim a imagem não pisca a cada segundo)
        if (fundo.getAttribute('src') !== imagemNova) {
            fundo.setAttribute('src', imagemNova);
        }
    }
}

// inicio automatica da pagina

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