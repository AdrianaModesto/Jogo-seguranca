// ============================================================================
// JUMPSCARE - quando o monstro pula no sobrevivente (finish_reason = 'killed')
// Módulo independente: cria o próprio overlay, o próprio CSS e o próprio som.
// Uso:
//   Jumpscare.prepare();                  // 1x, dentro de um clique (libera o áudio)
//   await Jumpscare.play();               // dispara o susto, resolve quando termina
// ============================================================================

const Jumpscare = (() => {
  const CONFIG = {
    imageSrc: 'jumpscare.jpg', // imagem do susto (se falhar ao carregar, usa o rosto desenhado em CSS)
    soundSrc: null,       // ex.: 'audio/jumpscare.mp3' (se null, usa o grito sintetizado)
    durationMs: 2000,     // tempo total do susto
    vibrate: [200, 80, 300, 80, 400],
  };

  let overlay = null;
  let audioCtx = null;
  let playing = false;

  // ---------- CSS injetado (pode mover para o style.css depois) ----------
  function injectStyles() {
    if (document.getElementById('jumpscare-styles')) return;
    const style = document.createElement('style');
    style.id = 'jumpscare-styles';
    style.textContent = `
      #jumpscare-overlay {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        background: #000; overflow: hidden;
        pointer-events: all; cursor: none;
      }
      #jumpscare-overlay.hidden { display: none; }

      #jumpscare-flash {
        position: absolute; inset: 0; background: #b00000; opacity: 0;
        animation: js-flash 0.18s steps(2) 6;
      }
      #jumpscare-face {
        position: relative; width: min(80vmin, 640px); aspect-ratio: 1;
        transform: scale(0.1); opacity: 0;
        animation:
          js-zoom 0.25s cubic-bezier(.1,.9,.2,1) forwards,
          js-shake 0.06s linear 0.25s infinite;
      }
      #jumpscare-face img { width: 100%; height: 100%; object-fit: contain; }

      /* imagem em tela cheia (cena completa do monstro) */
      #jumpscare-face.js-has-image {
        width: 100vw; height: 100vh; aspect-ratio: auto;
        animation:
          js-zoom-img 0.25s cubic-bezier(.1,.9,.2,1) forwards,
          js-shake 0.06s linear 0.25s infinite;
      }
      #jumpscare-face.js-has-image img { object-fit: cover; display: block; }

      /* rosto de reserva, caso não exista imagem */
      .js-fallback {
        width: 100%; height: 100%; border-radius: 45% 45% 40% 40%;
        background: radial-gradient(circle at 50% 40%, #2a0505, #050000 70%);
        box-shadow: 0 0 80px 20px #7a0000;
        position: relative;
      }
      .js-eye {
        position: absolute; top: 28%; width: 20%; height: 14%;
        background: #ff2a2a; border-radius: 50%;
        box-shadow: 0 0 40px 12px #ff0000;
      }
      .js-eye.left { left: 18%; transform: rotate(-12deg); }
      .js-eye.right { right: 18%; transform: rotate(12deg); }
      .js-mouth {
        position: absolute; left: 14%; right: 14%; bottom: 10%; height: 34%;
        background: #000; border-radius: 10% 10% 50% 50%;
        clip-path: polygon(0 0, 8% 38%, 16% 0, 25% 42%, 33% 0, 42% 46%, 50% 0,
                           58% 46%, 67% 0, 75% 42%, 84% 0, 92% 38%, 100% 0,
                           100% 100%, 0 100%);
        background: linear-gradient(#e8e0d0 0 45%, #1a0000 45%);
      }

      #jumpscare-overlay.js-glitch #jumpscare-face {
        filter: contrast(1.6) saturate(1.8) hue-rotate(-10deg);
      }

      @keyframes js-zoom {
        0%   { transform: scale(0.1); opacity: 0; }
        100% { transform: scale(1.35); opacity: 1; }
      }
      @keyframes js-zoom-img {
        0%   { transform: scale(0.7); opacity: 0; }
        100% { transform: scale(1.12); opacity: 1; }
      }
      @keyframes js-shake {
        0%   { translate: 0 0; }
        25%  { translate: -14px 8px; }
        50%  { translate: 12px -10px; }
        75%  { translate: -8px -12px; }
        100% { translate: 10px 6px; }
      }
      @keyframes js-flash {
        0%, 100% { opacity: 0; }
        50% { opacity: 0.85; }
      }
      @media (prefers-reduced-motion: reduce) {
        #jumpscare-flash { animation: none; opacity: 0.5; }
        #jumpscare-face { animation: js-zoom 0.25s forwards; }
        #jumpscare-face.js-has-image { animation: js-zoom-img 0.25s forwards; }
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- DOM ----------
  function buildOverlay() {
    if (overlay) return overlay;
    injectStyles();

    overlay = document.createElement('div');
    overlay.id = 'jumpscare-overlay';
    overlay.className = 'hidden';
    overlay.setAttribute('aria-hidden', 'true');

    const flash = document.createElement('div');
    flash.id = 'jumpscare-flash';

    const face = document.createElement('div');
    face.id = 'jumpscare-face';

    const fallbackHTML = `
      <div class="js-fallback">
        <div class="js-eye left"></div>
        <div class="js-eye right"></div>
        <div class="js-mouth"></div>
      </div>`;

    if (CONFIG.imageSrc) {
      const img = document.createElement('img');
      img.alt = '';
      img.onerror = () => {   // caminho errado? usa o rosto desenhado
        face.classList.remove('js-has-image');
        face.innerHTML = fallbackHTML;
      };
      img.src = CONFIG.imageSrc;
      face.classList.add('js-has-image');
      face.appendChild(img);
    } else {
      face.innerHTML = fallbackHTML;
    }

    overlay.append(flash, face);
    document.body.appendChild(overlay);
    return overlay;
  }

  // ---------- ÁUDIO ----------
  // Chame dentro de um clique do usuário (ex.: botão "Entrar na partida")
  function prepare() {
    buildOverlay();
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      console.warn('Jumpscare: áudio indisponível', e);
    }
    if (CONFIG.soundSrc && !prepare._audio) {
      prepare._audio = new Audio(CONFIG.soundSrc);
      prepare._audio.preload = 'auto';
    }
  }

  // Grito sintetizado: explosão de ruído + serras desafinadas subindo de tom
  function synthScream() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const dur = CONFIG.durationMs / 1000;

    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    master.connect(audioCtx.destination);

    // ruído branco
    const len = audioCtx.sampleRate * dur;
    const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 0.8;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.6;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(now);

    // duas serras desafinadas (grito agudo)
    [0, 37].forEach((detune) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(1500, now + 0.35);
      osc.frequency.linearRampToValueAtTime(1100, now + dur);

      // tremolo rápido para soar "rasgado"
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.value = 38;
      lfoGain.gain.value = 120;
      lfo.connect(lfoGain).connect(osc.frequency);

      const g = audioCtx.createGain();
      g.gain.value = 0.35;
      osc.connect(g).connect(master);
      osc.start(now);
      lfo.start(now);
      osc.stop(now + dur);
      lfo.stop(now + dur);
    });

    // batida grave de impacto
    const thump = audioCtx.createOscillator();
    const thumpGain = audioCtx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(35, now + 0.4);
    thumpGain.gain.setValueAtTime(1, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    thump.connect(thumpGain).connect(audioCtx.destination);
    thump.start(now);
    thump.stop(now + 0.5);
  }

  function playSound() {
    if (CONFIG.soundSrc) {
      const a = prepare._audio || new Audio(CONFIG.soundSrc);
      a.currentTime = 0;
      a.volume = 1;
      a.play().catch(() => synthScream());
    } else {
      synthScream();
    }
  }

  // ---------- API PÚBLICA ----------
  function play() {
    if (playing) return Promise.resolve();
    playing = true;

    buildOverlay();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // reinicia as animações caso já tenham rodado antes
    const clone = overlay.cloneNode(true);
    overlay.replaceWith(clone);
    overlay = clone;

    overlay.classList.remove('hidden');
    overlay.classList.add('js-glitch');
    document.body.style.overflow = 'hidden';

    playSound();
    if (navigator.vibrate) navigator.vibrate(CONFIG.vibrate);

    return new Promise((resolve) => {
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('js-glitch');
        document.body.style.overflow = '';
        playing = false;
        resolve();
      }, CONFIG.durationMs);
    });
  }

  function configure(options) {
    Object.assign(CONFIG, options);
    // força reconstruir o overlay com a nova imagem
    if (overlay) { overlay.remove(); overlay = null; }
  }

  return { prepare, play, configure, get isPlaying() { return playing; } };
})();
