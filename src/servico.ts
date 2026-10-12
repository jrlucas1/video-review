import type { Banco } from './banco';
import { ErroDaApi, naoEncontrado } from './erros';
import {
  PECAS,
  pendenciasDaEntrega,
  statusDaEntrega,
  type EstadoAtualPorPeca,
  type EstadoDaVersao,
  type Peca,
  type Pendencia,
} from './regra';

export interface Versao {
  id: number;
  entregaId: number;
  peca: Peca;
  numero: number;
  url: string;
  duracaoSegundos: number | null;
  estado: EstadoDaVersao;
  criadaEm: string;
}

export interface Comentario {
  id: number;
  versaoId: number;
  autor: string;
  texto: string;
  segundo: number | null;
  criadoEm: string;
}

interface Entrega {
  id: number;
  campanhaId: number;
  criador: string;
  aprovadaEm: string | null;
}

const COLUNAS_DA_VERSAO = `
  id, entrega_id AS entregaId, peca, numero, url,
  duracao_segundos AS duracaoSegundos, estado, criada_em AS criadaEm`;

const COLUNAS_DO_COMENTARIO = `
  id, versao_id AS versaoId, autor, texto, segundo, criado_em AS criadoEm`;

const MOTIVO_POR_EXTENSO: Record<Pendencia['motivo'], string> = {
  sem_versao: 'sem versão enviada',
  pendente: 'versão atual aguardando aprovação',
  ajustes_pedidos: 'versão atual com ajustes pedidos',
};

export type Servico = ReturnType<typeof criarServico>;

export function criarServico(banco: Banco, agora: () => Date) {
  // ---------- campanha ----------

  function pecasExigidas(campanhaId: number): Peca[] {
    const exigidas = banco
      .prepare('SELECT peca FROM campanha_peca_exigida WHERE campanha_id = ?')
      .pluck()
      .all(campanhaId) as Peca[];
    return PECAS.filter((peca) => exigidas.includes(peca));
  }

  function verCampanha(id: number) {
    const campanha = banco.prepare('SELECT id, nome FROM campanha WHERE id = ?').get(id) as
      | { id: number; nome: string }
      | undefined;
    if (!campanha) throw naoEncontrado('Campanha');
    return { ...campanha, pecasExigidas: pecasExigidas(id) };
  }

  const inserirCampanha = banco.transaction((nome: string, exigidas: Peca[]) => {
    const { lastInsertRowid } = banco.prepare('INSERT INTO campanha (nome) VALUES (?)').run(nome);
    const inserirPeca = banco.prepare(
      'INSERT INTO campanha_peca_exigida (campanha_id, peca) VALUES (?, ?)',
    );
    for (const peca of exigidas) inserirPeca.run(lastInsertRowid, peca);
    return Number(lastInsertRowid);
  });

  function criarCampanha(dados: { nome: string; pecasExigidas: Peca[] }) {
    return verCampanha(inserirCampanha(dados.nome, dados.pecasExigidas));
  }

  // ---------- entrega ----------

  function buscarEntrega(id: number): Entrega {
    const entrega = banco
      .prepare(
        `SELECT id, campanha_id AS campanhaId, criador, aprovada_em AS aprovadaEm
         FROM entrega WHERE id = ?`,
      )
      .get(id) as Entrega | undefined;
    if (!entrega) throw naoEncontrado('Entrega');
    return entrega;
  }

  function versoesAtuais(entregaId: number): Versao[] {
    return banco
      .prepare(
        `SELECT ${COLUNAS_DA_VERSAO}
         FROM versao AS atual
         WHERE entrega_id = ?
           AND numero = (
             SELECT MAX(numero) FROM versao
             WHERE entrega_id = atual.entrega_id AND peca = atual.peca
           )`,
      )
      .all(entregaId) as Versao[];
  }

  function verEntrega(id: number) {
    const entrega = buscarEntrega(id);
    const exigidas = pecasExigidas(entrega.campanhaId);
    const atuais = versoesAtuais(id);

    const estadoAtual: EstadoAtualPorPeca = {};
    for (const versao of atuais) estadoAtual[versao.peca] = versao.estado;
    const pendencias = pendenciasDaEntrega(exigidas, estadoAtual);

    return {
      id: entrega.id,
      campanhaId: entrega.campanhaId,
      criador: entrega.criador,
      status: statusDaEntrega(entrega.aprovadaEm !== null, pendencias),
      aprovacaoRegistradaEm: entrega.aprovadaEm,
      pendencias,
      pecas: PECAS.map((peca) => ({
        peca,
        exigida: exigidas.includes(peca),
        versaoAtual: atuais.find((versao) => versao.peca === peca) ?? null,
      })),
    };
  }

  function criarEntrega(campanhaId: number, dados: { criador: string }) {
    verCampanha(campanhaId);
    const { lastInsertRowid } = banco
      .prepare('INSERT INTO entrega (campanha_id, criador) VALUES (?, ?)')
      .run(campanhaId, dados.criador);
    return verEntrega(Number(lastInsertRowid));
  }

  function aprovarEntrega(id: number) {
    const { pendencias } = verEntrega(id);
    if (pendencias.length > 0) {
      const faltando = pendencias
        .map(({ peca, motivo }) => `${peca} (${MOTIVO_POR_EXTENSO[motivo]})`)
        .join(', ');
      throw new ErroDaApi(
        409,
        'PECAS_PENDENTES',
        `A entrega não pode ser aprovada. Peças exigidas pendentes: ${faltando}.`,
        { pendencias },
      );
    }
    // Aprovar de novo não muda a data da primeira aprovação.
    banco
      .prepare('UPDATE entrega SET aprovada_em = ? WHERE id = ? AND aprovada_em IS NULL')
      .run(agora().toISOString(), id);
    return verEntrega(id);
  }

  // ---------- versão ----------

  function buscarVersao(id: number): Versao {
    const versao = banco
      .prepare(`SELECT ${COLUNAS_DA_VERSAO} FROM versao WHERE id = ?`)
      .get(id) as Versao | undefined;
    if (!versao) throw naoEncontrado('Versão');
    return versao;
  }

  function ehVersaoAtual(versao: Versao): boolean {
    return versoesAtuais(versao.entregaId).some((atual) => atual.id === versao.id);
  }

  function exigirVersaoAtual(versao: Versao): void {
    if (ehVersaoAtual(versao)) return;
    throw new ErroDaApi(
      409,
      'VERSAO_SUBSTITUIDA',
      `A versão ${versao.numero} de ${versao.peca} já foi substituída por uma mais nova.`,
    );
  }

  const inserirVersao = banco.transaction(
    (entregaId: number, peca: Peca, url: string, duracaoSegundos: number | null) => {
      const numero = banco
        .prepare(
          `SELECT COALESCE(MAX(numero), 0) + 1 FROM versao WHERE entrega_id = ? AND peca = ?`,
        )
        .pluck()
        .get(entregaId, peca) as number;
      const { lastInsertRowid } = banco
        .prepare(
          `INSERT INTO versao (entrega_id, peca, numero, url, duracao_segundos, criada_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(entregaId, peca, numero, url, duracaoSegundos, agora().toISOString());
      return Number(lastInsertRowid);
    },
  );

  /** A versão nova nasce pendente e passa a ser a atual da peça, em qualquer estado da anterior. */
  function enviarVersao(
    entregaId: number,
    peca: Peca,
    dados: { url: string; duracaoSegundos?: number },
  ): Versao {
    buscarEntrega(entregaId);
    if (peca === 'video' && dados.duracaoSegundos === undefined) {
      throw new ErroDaApi(422, 'DURACAO_OBRIGATORIA', 'Versão de vídeo exige duracaoSegundos.');
    }
    if (peca !== 'video' && dados.duracaoSegundos !== undefined) {
      throw new ErroDaApi(422, 'DURACAO_SO_EM_VIDEO', `duracaoSegundos não se aplica a ${peca}.`);
    }
    return buscarVersao(inserirVersao(entregaId, peca, dados.url, dados.duracaoSegundos ?? null));
  }

  function listarVersoes(entregaId: number, peca: Peca): Versao[] {
    buscarEntrega(entregaId);
    return banco
      .prepare(
        `SELECT ${COLUNAS_DA_VERSAO} FROM versao
         WHERE entrega_id = ? AND peca = ? ORDER BY numero`,
      )
      .all(entregaId, peca) as Versao[];
  }

  /** Os comentários são os desta versão, e só os dela. */
  function verVersao(id: number) {
    const versao = buscarVersao(id);
    const comentarios = banco
      .prepare(
        `SELECT ${COLUNAS_DO_COMENTARIO} FROM comentario
         WHERE versao_id = ? ORDER BY segundo, id`,
      )
      .all(id) as Comentario[];
    return { ...versao, atual: ehVersaoAtual(versao), comentarios };
  }

  /** pendente -> aprovada ou pendente -> ajustes_pedidos. As duas decisões são finais. */
  function decidirVersao(id: number, decisao: 'aprovada' | 'ajustes_pedidos') {
    const versao = buscarVersao(id);
    exigirVersaoAtual(versao);
    if (versao.estado !== 'pendente') {
      throw new ErroDaApi(
        409,
        'VERSAO_JA_DECIDIDA',
        `A versão ${versao.numero} de ${versao.peca} já está como ${versao.estado}.`,
      );
    }
    banco.prepare('UPDATE versao SET estado = ? WHERE id = ?').run(decisao, id);
    return verVersao(id);
  }

  // ---------- comentário ----------

  function comentar(
    versaoId: number,
    dados: { autor: string; texto: string; segundo?: number },
  ): Comentario {
    const versao = buscarVersao(versaoId);
    exigirVersaoAtual(versao);

    if (versao.peca !== 'video') {
      if (dados.segundo !== undefined) {
        throw new ErroDaApi(422, 'SEGUNDO_SO_EM_VIDEO', `segundo não se aplica a ${versao.peca}.`);
      }
    } else {
      if (dados.segundo === undefined) {
        throw new ErroDaApi(422, 'SEGUNDO_OBRIGATORIO', 'Comentário em vídeo exige segundo.');
      }
      if (versao.duracaoSegundos !== null && dados.segundo > versao.duracaoSegundos) {
        throw new ErroDaApi(
          422,
          'SEGUNDO_FORA_DO_VIDEO',
          `O vídeo tem ${versao.duracaoSegundos}s; não existe o segundo ${dados.segundo}.`,
        );
      }
    }

    const { lastInsertRowid } = banco
      .prepare(
        `INSERT INTO comentario (versao_id, autor, texto, segundo, criado_em)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(versaoId, dados.autor, dados.texto, dados.segundo ?? null, agora().toISOString());
    return banco
      .prepare(`SELECT ${COLUNAS_DO_COMENTARIO} FROM comentario WHERE id = ?`)
      .get(lastInsertRowid) as Comentario;
  }

  return {
    criarCampanha,
    verCampanha,
    criarEntrega,
    verEntrega,
    aprovarEntrega,
    enviarVersao,
    listarVersoes,
    verVersao,
    decidirVersao,
    comentar,
  };
}
