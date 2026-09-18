// Baixa o Chrome Headless Shell na imagem, em tempo de BUILD — assim o
// container não perde tempo (nem depende da rede) baixando isso no primeiro
// job. Chamado como RUN no Dockerfile.
import { ensureBrowser } from '@remotion/renderer';

await ensureBrowser();
console.log('Chrome Headless Shell garantido.');
