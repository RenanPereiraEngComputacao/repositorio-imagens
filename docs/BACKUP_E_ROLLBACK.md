# Backup, restauração e rollback

## O que precisa de backup
| Item | Onde | Como |
|---|---|---|
| Banco | PostgreSQL (`DATABASE_URL`) | `pg_dump -Fc` |
| Imagens | `UPLOAD_ROOT` | `rsync` incremental |
| Lixeira | `TRASH_ROOT` | `rsync` (mesmo script) |
| Configuração | `.env` | cópia segura (contém segredos — não enviar a terceiros) |

## Backup automático
`scripts/backup.sh` faz banco + imagens + lixeira, mantendo 14 dias de dumps:
```bash
BACKUP_DIR=/srv/backups/malagah ./scripts/backup.sh
```
Agende no cron (ver INSTALACAO.md). Recomenda-se copiar `BACKUP_DIR` para outro servidor ou storage externo.

## Restaurar um backup completo
```bash
pm2 stop stylezee-imagens
pg_restore --clean --if-exists -d "$DATABASE_URL" /srv/backups/malagah/db-AAAAMMDD-HHMM.dump
rsync -a --delete /srv/backups/malagah/imagens/ "$UPLOAD_ROOT"/
pm2 start stylezee-imagens
```
Teste a restauração periodicamente em um banco separado (`createdb teste_restore && pg_restore -d teste_restore ...`).

## Lixeira (exclusões recuperáveis)
Tudo que é excluído pelo painel — coleção, produto ou imagem — vai para a lixeira:
- Os **registros** ficam gravados em `trash_entries.manifest` (JSON completo).
- Os **arquivos** são movidos para `TRASH_ROOT/<data>-<tipo>-<id>-<nome>/arquivos/`, fora da área pública, junto de um `manifest.json`.

Restaurar:
- Pelo painel: **Lixeira → Restaurar**.
- Pela linha de comando: `npm run trash:list` e `npm run trash:restore -- <id>`.

A restauração recoloca registros (com os mesmos IDs) e arquivos nos mesmos caminhos — links e QR Codes voltam a funcionar. Ela é recusada, sem alterar nada, se a referência/slug já tiver sido reutilizada.

Purga definitiva: `npm run trash:purge -- --days 30`.

### Operações interrompidas
A exclusão move os arquivos antes do `COMMIT` no banco. Se o servidor cair no meio, o manifesto fica com status `pending`; na próxima inicialização (ou com `node scripts/trash.js recover`) os arquivos são devolvidos automaticamente e nada é perdido.

## Rollback para a versão anterior
A migração 2.0 é apenas aditiva, então a versão antiga funciona com o banco já migrado:
```bash
pm2 delete stylezee-imagens
cd /var/www/repositorio-imagens          # pasta da versão antiga
pm2 start ecosystem.config.cjs && pm2 save
```
Observações:
- Imagens enviadas na 2.0 continuam visíveis na versão antiga (mesmo formato de `file_url`).
- As pastas `_web/` (versões otimizadas) são ignoradas pela versão antiga e podem permanecer.
- Itens na lixeira não aparecem na versão antiga; restaure-os antes, se necessário.

### Remover as estruturas novas (opcional — só se for abandonar a 2.0 definitivamente)
```sql
BEGIN;
DROP TABLE IF EXISTS trash_entries;
DROP TABLE IF EXISTS audit_log;
ALTER TABLE product_images
  DROP COLUMN IF EXISTS original_name, DROP COLUMN IF EXISTS mime_type, DROP COLUMN IF EXISTS size_bytes,
  DROP COLUMN IF EXISTS width, DROP COLUMN IF EXISTS height, DROP COLUMN IF EXISTS display_path,
  DROP COLUMN IF EXISTS display_url, DROP COLUMN IF EXISTS thumb_path, DROP COLUMN IF EXISTS thumb_url;
DELETE FROM schema_migrations WHERE name = '001_malagah_v2.sql';
COMMIT;
```
Faça backup antes: isso apaga o histórico de auditoria e a lixeira.
