// Isto — e só isto — é o que a IA devolve. Índices na lista numerada de
// palavras da transcrição, nunca segundo/timestamp: elimina estruturalmente a
// maior classe de falha (a IA "alucinando" um tempo que não bate com a fala).
//
// edit-plan-builder.ts expande isto deterministicamente no EditPlan completo
// (edit-plan.types.ts) — layout de linha, agrupamento de legenda, clamp de
// zoom, tudo por regra fixa, não por decisão do modelo.
export interface EditPlanDraft {
  hookStartWordIdx: number;
  hookEndWordIdx: number;
  // Índice, dentro do intervalo do gancho, da palavra que vai pro serif
  // gigante — geralmente o substantivo/verbo mais forte da frase.
  hookDisplayWordIdx: number;
  // Índices ONDE quebrar linha (a quebra acontece DEPOIS da palavra nesse
  // índice). Não inclui a quebra antes/depois da palavra de destaque — essa é
  // sempre linha própria, decidida pelo builder.
  hookLineBreaksAfterIdx: number[];
  // Por que esse trecho foi escolhido — mostrado no editor pro usuário
  // avaliar a escolha em vez de adivinhar.
  hookReason: string;
  titleOverlayText: string;
  impactRanges: { startWordIdx: number; endWordIdx: number; strength: 'medium' | 'strong' }[];
  bodyCaptionsEnabled: boolean;
  // true só quando a instrução do usuário pede explicitamente pra cortar
  // pausa/silêncio/respiro — decide se edit-plan-builder.ts vai gerar
  // body.segments (corte de pausa) em vez do corpo contínuo de sempre. Falso
  // por padrão: não muda o comportamento de quem não pediu.
  removePauses: boolean;
  musicMood: string;
  warnings: string[];
}
