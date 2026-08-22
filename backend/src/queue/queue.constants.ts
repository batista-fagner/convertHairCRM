// Nomes de fila e de job em um lugar só — produtor e processor precisam concordar
// exatamente na string, e errar isso não quebra o build, só faz o job nunca rodar.

// Liga o caminho novo (filas) no lugar dos @Cron que varrem o banco. Qualquer valor
// diferente de 'bullmq' mantém o comportamento legado — é a chave de rollback.
export const QUEUE_ENGINE_BULLMQ = 'bullmq';
