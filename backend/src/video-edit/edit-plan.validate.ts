import { EditPlan } from './edit-plan.types';

export interface EditPlanValidation {
  ok: boolean;
  errors: string[];
}

// Segunda linha de defesa depois do builder determinístico — pega o que
// escaparia por transcrição maluca (índice fora do range já é tratado no
// builder via clamp, isto aqui pega o que sobra: durações absurdas, tempo não
// monotônico, referência a asset que não existe).
export const validateEditPlan = (plan: EditPlan): EditPlanValidation => {
  const errors: string[] = [];

  const hookDur = plan.hook.srcEndSec - plan.hook.srcStartSec;
  if (plan.hook.srcStartSec < 0) errors.push('Gancho começa antes do início do vídeo');
  if (plan.hook.srcEndSec > plan.source.srcDurationSec + 0.5) errors.push('Gancho termina depois do fim do vídeo');
  if (hookDur < 1.8 || hookDur > 9) errors.push(`Duração do gancho fora da faixa aceita (${hookDur.toFixed(2)}s, esperado 1.8-9s)`);

  if (plan.body.srcStartSec !== 0) errors.push('Corpo deveria sempre começar em 0 (o vídeo completo)');
  if (plan.body.srcEndSec <= plan.body.srcStartSec) errors.push('Corpo com duração zero ou negativa');

  if (plan.body.segments && plan.body.segments.length > 0) {
    let prevSegEnd = -Infinity;
    for (const seg of plan.body.segments) {
      if (seg.srcEndSec <= seg.srcStartSec) errors.push('Segmento de corte de pausa com duração zero ou negativa');
      if (seg.srcStartSec < prevSegEnd - 0.001) errors.push('Segmentos de corte de pausa fora de ordem ou sobrepostos');
      if (seg.srcStartSec < 0 || seg.srcEndSec > plan.source.srcDurationSec + 0.5) errors.push('Segmento de corte de pausa fora dos limites do vídeo');
      prevSegEnd = seg.srcEndSec;
    }
  }

  let prevEnd = -Infinity;
  for (const line of plan.hook.caption.lines) {
    for (const word of line.words) {
      if (word.srcEndSec < word.srcStartSec) { errors.push(`Palavra "${word.text}" com fim antes do início`); break; }
      if (word.srcStartSec < prevEnd - 0.01) { errors.push('Palavras do gancho fora de ordem no tempo'); break; }
      prevEnd = word.srcEndSec;
    }
  }

  for (const zoom of plan.zooms) {
    if (zoom.to < 1 || zoom.to > 1.35) errors.push(`Zoom fora da faixa aceita (${zoom.to})`);
    if (zoom.srcEndSec <= zoom.srcStartSec) errors.push('Zoom com duração zero ou negativa');
  }

  const assetIds = Object.keys(plan.assets ?? {});
  if (plan.transition.sfxAssetId && !assetIds.includes(plan.transition.sfxAssetId)) {
    errors.push('Efeito de transição aponta pra um asset inexistente');
  }
  if (plan.music.assetId && !assetIds.includes(plan.music.assetId)) {
    errors.push('Música aponta pra um asset inexistente');
  }

  return { ok: errors.length === 0, errors };
};
