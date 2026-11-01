export interface CepAddress {
  street: string
  neighborhood: string
  city: string
  state: string
}

/**
 * Consulta o ViaCEP (serviço público de terceiros — recebe apenas o CEP).
 * Devolve `null` se o CEP não existe; lança se a rede falhar (o chamador
 * deixa o usuário preencher à mão).
 */
export async function lookupCep(cep: string): Promise<CepAddress | null> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
  const d = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
  if (d.erro) return null
  return { street: d.logradouro ?? '', neighborhood: d.bairro ?? '', city: d.localidade ?? '', state: d.uf ?? '' }
}
