// Composição de vídeo — 9:16 pra Reels/Stories/anúncios da Meta.
//
// ATENÇÃO: tudo nesta pasta é compilado por DOIS bundlers diferentes — o Vite
// (preview no CRM) e o webpack do Remotion (render no serviço separado). Por
// isso valem três regras que não podem ser quebradas:
//   1. Só estilo inline. Nenhuma classe Tailwind — o bundler do Remotion não
//      tem PostCSS, então a classe aparece estilizada no preview e SEM estilo
//      no vídeo final. É a divergência silenciosa que o projeto inteiro existe
//      pra evitar.
//   2. Importar só `react`, `remotion` e `@remotion/*`. Nada de import.meta.env,
//      estado do app, fetch ou qualquer coisa de fora desta pasta.
//   3. Fontes vêm de staticFile(), nunca da rede.
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const COMPOSITION_ID = 'VideoEdit';
