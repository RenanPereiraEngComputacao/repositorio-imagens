# Segurança

| Controle | Implementação |
|---|---|
| Autenticação | bcrypt (`ADMIN_PASSWORD_HASH`), comparação em tempo constante, novo ID de sessão no login, limite de tentativas por IP |
| Sessões | PostgreSQL (`connect-pg-simple`), cookie `httpOnly`, `sameSite=lax`, `secure` em HTTPS, expiração deslizante |
| CSRF | Token por sessão em **todas** as requisições que alteram dados, inclusive uploads e importação (cabeçalho `X-CSRF-Token` ou campo) — verificado antes de gravar qualquer arquivo |
| Path traversal | Todo caminho vindo do banco passa por `services/storage.resolveStoredPath` (prefixo `imagens/`, sem `..`, sem absolutos, sem byte nulo) e `assertSafeFile` (arquivo regular, dentro da raiz real, sem links simbólicos) |
| Upload | Extensão + MIME permitidos, conteúdo verificado com `sharp`, limite de tamanho e quantidade, gravação em pasta temporária antes de mover |
| Exposição pública | Apenas produto **e** coleção ativos; downloads exigem que a imagem pertença à referência informada |
| Exclusões | Confirmação validada no servidor, token de uso único com expiração, advisory lock + `FOR UPDATE NOWAIT` contra exclusões simultâneas, conferência de impacto, auditoria |
| Cabeçalhos | Helmet com CSP restritiva (sem scripts/estilos inline), `frame-ancestors 'none'`, `noindex` no painel, `Cache-Control: no-store` no painel |
| Erros | Mensagens internas nunca são exibidas; apenas erros de validação conhecidos |
| Configuração | Em produção o servidor não inicia sem `SESSION_SECRET` e senha do admin; `.env` fora do controle de versão; lixeira não pode ficar dentro da pasta pública |

## Pontos de atenção operacionais
- O arquivo `.env` que veio no pacote anterior continha credenciais reais. **Recomenda-se trocar a senha do banco, o `SESSION_SECRET` e a senha do administrador** se esse pacote foi compartilhado. (Trocar `SESSION_SECRET` desconecta todos.)
- Originais são preservados como enviados — incluindo metadados EXIF (ex.: localização de câmeras de celular). Se isso for sensível, remova os metadados antes do envio.
- O limite de tentativas de login é por processo; com várias instâncias, use também `limit_req` no Nginx.
