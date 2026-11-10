# MÁLAGAH — Acervo de imagens

Sistema web para administrar coleções, produtos (referências) e imagens, com página pública acessada pelos QR Codes das etiquetas:

```txt
https://seu-dominio.com.br/imagens/{referencia}
```

O sistema não gera QR Codes — ele atende as URLs já impressas, que **foram mantidas sem alteração**.

Stack mantida: **Node.js 20+, Express 4, PostgreSQL, EJS**.

## O que há nesta versão (2.0)

**Administração**
- Visão geral com indicadores reais (coleções, produtos, imagens, cobertura do catálogo, armazenamento, atividade recente, produtos aguardando fotos).
- Coleções e produtos: cadastro, edição e exclusão, com busca, filtros, paginação e visualização em grade ou lista.
- Galeria por produto: miniaturas, imagem principal, ordenação (arrastar ou setas), exclusão com confirmação.
- Envio múltiplo com validação no navegador e no servidor, barra de progresso por arquivo, falhas isoladas e “tentar novamente”.
- Envio em massa pelo nome do arquivo e importação de planilha (com modo de simulação).
- Exclusão de coleção em duas etapas (impacto → frase de confirmação), com lixeira recuperável.
- Histórico de atividade (auditoria) e lixeira com restauração.

**Página pública**
- Galeria mobile-first, versões otimizadas para carregamento rápido.
- Visualização ampliada com navegação por setas, teclado e gesto de deslizar.
- Download individual em **resolução original** e de **todas as imagens em ZIP**.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação do zero (servidor Linux, Nginx, PM2) |
| [docs/ATUALIZACAO.md](docs/ATUALIZACAO.md) | **Como atualizar a versão atual em produção para esta** |
| [docs/BACKUP_E_ROLLBACK.md](docs/BACKUP_E_ROLLBACK.md) | Backup, restauração, lixeira e como voltar à versão anterior |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Controles de segurança implementados |
| [CHANGELOG.md](CHANGELOG.md) | Resumo das alterações |

## Comandos

```bash
npm start                     # inicia o servidor
npm run db:migrate            # aplica migrações pendentes (seguro reaplicar)
npm run db:migrate:status     # lista migrações aplicadas/pendentes
npm run admin:hash -- "senha" # gera o hash da senha do administrador
npm run images:derivatives    # gera versões otimizadas das imagens antigas (não altera originais)
npm run trash:list            # lista a lixeira
npm run trash:restore -- 12   # restaura o item #12 da lixeira
npm run trash:purge -- --days 30  # apaga definitivamente itens com mais de 30 dias
TEST_DATABASE_URL=postgres://usuario@localhost:5432/postgres npm test   # testes automatizados
```

## Estrutura

```txt
src/
  app.js                 configuração do Express (segurança, sessão, rotas)
  server.js              inicialização, recuperação de operações interrompidas, desligamento gracioso
  config.js  db.js
  middleware/            auth, csrf, flash, upload
  routes/public.js       página pública, downloads e ZIP
  routes/admin/          painel dividido por área (coleções, produtos, imagens, envio, importação, atividade)
  services/              storage (caminhos seguros), images, image-processing, trash (lixeira), audit
  views/                 templates EJS (admin, public, partials)
public/assets/           CSS do design system, JS, ícones e fontes (auto-hospedadas)
db/schema.sql            estrutura base (idempotente)
db/migrations/           migrações incrementais
scripts/                 migrate, trash, generate-derivatives, create-admin-hash
test/                    testes de integração (banco descartável)
```
