import * as dotenv from 'dotenv';
import { QUEUE_ENGINE_BULLMQ } from './queue.constants';

// Os @Module são avaliados na importação do arquivo, ANTES do ConfigModule ler o .env —
// por isso a leitura aqui é direta do process.env. No Railway as variáveis já vêm do
// ambiente; localmente o dotenv preenche o que faltar (ele nunca sobrescreve o que já
// existe em process.env, então o ambiente continua tendo precedência).
dotenv.config({ path: process.env.ENV_FILE || '.env' });

// Registro das filas é condicional de propósito: sem isso o BullMQ abriria conexão com
// Redis em TODO ambiente — inclusive onde não existe Redis nenhum, onde só produziria
// erro de conexão em loop sem nenhuma fila sendo usada.
export const queueEngineEnabled = process.env.QUEUE_ENGINE === QUEUE_ENGINE_BULLMQ;
