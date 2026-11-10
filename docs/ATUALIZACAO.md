# Atualização da versão anterior para a 2.0

A atualização é **aditiva**: nenhuma tabela, coluna, imagem ou URL existente é removida ou alterada. A versão anterior continua funcionando com o banco já migrado, o que permite voltar atrás a qualquer momento (veja [BACKUP_E_ROLLBACK.md](BACKUP_E_ROLLBACK.md)).

Tempo estimado: 10–15 minutos, com cerca de 10 segundos de indisponibilidade (reinício do processo).

## 0. Antes de começar
- Anote os valores atuais de `UPLOAD_ROOT`, `PORT` e `BASE_URL` do `.env`.
- Confirme a versão do Node: `node -v` (precisa ser 20+).

## 1. Backup (obrigatório)
```bash
cd /var/www/repositorio-imagens          # pasta atual
STAMP=$(date +%Y%m%d-%H%M)
pg_dump "$DATABASE_URL" -Fc -f ~/backup-imagens-$STAMP.dump
tar -czf ~/backup-codigo-$STAMP.tgz --exclude=node_modules --exclude=public/imagens .
# Imagens: cópia incremental (rápida nas próximas vezes)
rsync -a public/imagens/ ~/backup-imagens-arquivos/
```
Confira que os arquivos foram criados e têm tamanho > 0.

## 2. Instalar a nova versão ao lado da atual
```bash
cd /var/www
mkdir malagah-imagens-v2 && cd malagah-imagens-v2
# extraia aqui o pacote da nova versão
cp ../repositorio-imagens/.env .env
npm ci --omit=dev
```

Ajuste o `.env` (veja `.env.example`):
- **Mantenha `UPLOAD_ROOT` apontando para a pasta de imagens atual**, com caminho absoluto, ex.: `UPLOAD_ROOT=/var/www/repositorio-imagens/public/imagens`. Assim as imagens não precisam ser copiadas nem movidas.
- Adicione `TRASH_ROOT=/var/www/malagah-dados/lixeira` (fora da pasta pública; de preferência no mesmo disco).
- Confirme `SESSION_SECRET` — **use o mesmo valor** para manter as sessões abertas.

## 3. Migrar o banco (com a versão antiga ainda no ar)
```bash
npm run db:migrate:status     # deve listar 001_malagah_v2.sql como PENDENTE
npm run db:migrate
```
A migração só faz `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`. Pode ser executada novamente sem efeito colateral.

## 4. Trocar o processo
```bash
pm2 stop stylezee-imagens
cd /var/www/malagah-imagens-v2
pm2 delete stylezee-imagens && pm2 start ecosystem.config.cjs && pm2 save
pm2 logs stylezee-imagens --lines 20     # deve mostrar "servidor iniciado"
```
(Ou, se preferir manter a mesma pasta, substitua o código em `/var/www/repositorio-imagens` preservando `.env` e `public/imagens/`.)

## 5. Verificação (5 minutos)
1. Abra 3 QR Codes/URLs antigas `/imagens/{referencia}` — devem abrir a nova galeria.
2. Abra uma URL direta de arquivo antiga (`/imagens/colecao/ref/arquivo.jpg`).
3. Clique em “Baixar imagem atual” e “Baixar todas em ZIP”.
4. Entre no painel `/admin` (a sessão anterior deve continuar válida) e confira o dashboard.
5. Envie uma imagem de teste para um produto e depois exclua-a (ela vai para a lixeira).

## 6. Gerar versões otimizadas das imagens antigas (recomendado)
Imagens enviadas antes desta versão funcionam normalmente, mas são exibidas pelo arquivo original. Para carregar mais rápido:
```bash
npm run images:derivatives -- --dry-run   # mostra quantas serão processadas
npm run images:derivatives                # cria arquivos *.display.webp e *.thumb.webp em _web/
```
O script **não altera nem move** os originais e pode ser interrompido/reexecutado.

## 7. Nginx
Se o Nginx tiver `client_max_body_size` menor que o necessário para o envio, ajuste (ver INSTALACAO.md). Se ele servir `/imagens/` diretamente, adicione `disable_symlinks on;`.

## Se algo der errado
Siga a seção “Rollback” de [BACKUP_E_ROLLBACK.md](BACKUP_E_ROLLBACK.md) — basta voltar o processo PM2 para a pasta antiga; o banco migrado é compatível com a versão anterior.
