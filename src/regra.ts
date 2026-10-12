export const PECAS = ['roteiro', 'video', 'capa', 'legenda'] as const;
export type Peca = (typeof PECAS)[number];

export const ESTADOS_DA_VERSAO = ['pendente', 'aprovada', 'ajustes_pedidos'] as const;
export type EstadoDaVersao = (typeof ESTADOS_DA_VERSAO)[number];

export type MotivoDaPendencia = 'sem_versao' | 'pendente' | 'ajustes_pedidos';

export interface Pendencia {
  peca: Peca;
  motivo: MotivoDaPendencia;
}

export type StatusDaEntrega = 'em_producao' | 'aprovada';

/** Estado da versão atual de cada peça. Peça sem versão não aparece. */
export type EstadoAtualPorPeca = Partial<Record<Peca, EstadoDaVersao>>;

/**
 * Peças exigidas pela campanha cuja versão atual ainda não está aprovada.
 * Peça que a campanha não exige nunca aparece aqui, qualquer que seja o estado dela.
 */
export function pendenciasDaEntrega(
  pecasExigidas: readonly Peca[],
  estadoAtual: EstadoAtualPorPeca,
): Pendencia[] {
  const pendencias: Pendencia[] = [];
  for (const peca of pecasExigidas) {
    const estado = estadoAtual[peca];
    if (estado === 'aprovada') continue;
    pendencias.push({ peca, motivo: estado ?? 'sem_versao' });
  }
  return pendencias;
}

/**
 * A aprovação da entrega é um fato registrado; o status é calculado a partir dele
 * e das versões atuais. Por isso uma versão nova derruba o status sem tocar no
 * registro, e ele volta quando essa versão é aprovada.
 */
export function statusDaEntrega(
  aprovacaoRegistrada: boolean,
  pendencias: readonly Pendencia[],
): StatusDaEntrega {
  return aprovacaoRegistrada && pendencias.length === 0 ? 'aprovada' : 'em_producao';
}
