/** Erro esperado da aplicação. Vira resposta HTTP com `status`, `erro` e `mensagem`. */
export class ErroDaApi extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export function naoEncontrado(oQue: string): ErroDaApi {
  return new ErroDaApi(404, 'NAO_ENCONTRADO', `${oQue} não existe.`);
}
