# Alterações — versão 2.0 (MÁLAGAH)

## Preservado (compatibilidade)
- URLs públicas `/imagens/{referencia}` e `/imagens/{colecao}/{referencia}/{arquivo}` — QR Codes impressos continuam válidos.
- Rota de download `/download/{referencia}/{id}`.
- Tabelas e colunas existentes: nenhuma removida ou renomeada. A migração apenas **adiciona** colunas/tabelas.
- Formato de `file_path`/`file_url` gravado no banco e estrutura de pastas das imagens.
- Sessões: mesma tabela `session` e mesmo nome de cookie (`stylezee.sid`), ninguém é desconectado.
- Login por `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (ou `ADMIN_PASSWORD`).
- Nome do processo PM2 (`stylezee-imagens`) para não quebrar scripts de deploy.

## Novo
- Identidade visual MÁLAGAH completa: design system (tokens de cor, tipografia Cormorant Garamond + Jost auto-hospedadas, componentes reutilizáveis), experiências separadas para administração e cliente.
- Dashboard com estatísticas reais.
- Busca, filtros, paginação e visualização em grade/lista para produtos e coleções.
- Exclusão de produto (confirmação digitando a referência) e de coleção (duas etapas: impacto + frase `EXCLUIR {slug}`).
- Lixeira recuperável para coleções, produtos e imagens (arquivos movidos para fora da área pública, com manifesto e restauração pelo painel ou CLI).
- Auditoria (`audit_log`) de login, criação, edição, exclusão, envio, ordenação e importação.
- Upload: original preservado (download em resolução máxima), versões otimizadas `display` (1600px) e `thumb` (480px) em WEBP, metadados (dimensões, tamanho, tipo).
- Upload com progresso por arquivo, falhas isoladas, nova tentativa, validação real do conteúdo (não confia na extensão).
- Página pública: galeria com miniaturas, lightbox (setas, teclado, gesto), download individual original e ZIP de todas as imagens, copiar/compartilhar link, feedback visual.
- Importação de planilha aceita também o formato do ERP (`REFERENCIA_PRODUTO`, `DESCRICAO_PRODUTO`, `CORES`, `COLECAO_PRODUTO`), modo de simulação, relatório por linha.
- Sistema de migrações versionado (`schema_migrations`) com trava contra execução simultânea.
- Testes automatizados (35) para exclusões, downloads, permissões e integridade.

## Corrigido
- **Importação de planilha sem proteção CSRF** (a rota era explicitamente liberada) — agora protegida.
- Importação falhava em referências existentes: `ON CONFLICT (reference)` não correspondia ao índice `LOWER(reference)`.
- Importação sobrescrevia nome/descrição com vazio quando a coluna não existia na planilha.
- Upload redimensionava e **sobrescrevia o original** — agora o original é mantido.
- Um arquivo inválido derrubava todo o lote de upload.
- Arquivos eram gravados na pasta pública antes de serem validados (agora passam por pasta temporária).
- Mensagens internas de erro (ex.: do banco) eram exibidas ao usuário.
- Estilos inline bloqueados pela própria CSP na tela de importação.
- `removeStoredFile` aceitava caminhos como `imagens/../x` em alguns casos; toda resolução de caminho agora passa por `services/storage.js`.
- Login sem limite de tentativas e sem renovação do ID de sessão (fixação de sessão).

## Dependências
- `multer` 1.4.5-lts → 2.x (correções de segurança, mesma API).
- `xlsx` 0.18.5 (npm, sem manutenção e com vulnerabilidades conhecidas) → 0.20.3 do repositório oficial SheetJS.
- Novas: `archiver` (ZIP em streaming). Desenvolvimento: `supertest`, `adm-zip`.
