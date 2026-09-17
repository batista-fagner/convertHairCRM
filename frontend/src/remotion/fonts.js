import { useState, useEffect } from 'react';
import { staticFile, delayRender, continueRender } from 'remotion';

// As duas tipografias da legenda do gancho. Trocar de fonte é mudar o arquivo
// em public/fonts/ e estas quatro constantes — nada mais no projeto sabe o nome
// delas.
export const FONT_DISPLAY = 'PlayfairDisplayVideo';
export const FONT_CONDENSED = 'ArchivoNarrowVideo';

// A pilha de reserva importa: se a fonte falhar, o vídeo renderiza mesmo assim
// (feio, mas legível) em vez de sair em sans-serif genérica do sistema.
export const DISPLAY_STACK = `"${FONT_DISPLAY}", Georgia, "Times New Roman", serif`;
export const CONDENSED_STACK = `"${FONT_CONDENSED}", "Arial Narrow", Helvetica, Arial, sans-serif`;

let fontPromise = null;

// Carrega uma vez por processo. staticFile() resolve tanto no Vite quanto no
// bundle do Remotion, desde que o Dockerfile copie frontend/public.
const ensureFonts = () => {
  if (fontPromise) return fontPromise;
  fontPromise = Promise.all([
    new FontFace(
      FONT_DISPLAY,
      `url(${staticFile('fonts/playfair-display-900.woff2')}) format('woff2')`,
      { weight: '900', style: 'normal' },
    ).load(),
    new FontFace(
      FONT_CONDENSED,
      `url(${staticFile('fonts/archivo-narrow-700.woff2')}) format('woff2')`,
      { weight: '700', style: 'normal' },
    ).load(),
  ]).then((faces) => {
    faces.forEach((f) => document.fonts.add(f));
  });
  return fontPromise;
};

// Segura o render até as fontes existirem. Sem isso o Remotion fotografa o
// primeiro quadro com a fonte de reserva e o vídeo sai com a tipografia errada
// — falha que não dá erro nenhum, só um resultado ruim.
export const useFontsReady = () => {
  const [handle] = useState(() => delayRender('Carregando fontes da legenda'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureFonts()
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setReady(true);
        continueRender(handle);
      });
    return () => { cancelled = true; };
  }, [handle]);

  return ready;
};
