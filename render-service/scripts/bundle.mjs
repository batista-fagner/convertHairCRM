// Empacota as composições React em tempo de BUILD (economiza ~30s e algumas
// centenas de MB de RAM por job — sem isso o worker teria que rebundlar a
// cada render). Chamado como RUN no Dockerfile, de dentro de /app.
import { bundle } from '@remotion/bundler';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const outDir = await bundle({
  entryPoint: join(root, 'src', 'remotion', 'index.js'),
  outDir: join(root, 'bundle'),
  // frontend/public (copiado pro mesmo lugar que o Vite usa) já é detectado
  // por convenção, mas fixamos explícito pra não depender de heurística.
  publicDir: join(root, 'public'),
});

console.log('Bundle pronto em', outDir);
