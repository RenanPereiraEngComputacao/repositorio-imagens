# Instalação (servidor novo)

> Para atualizar um servidor que já roda a versão anterior, siga [ATUALIZACAO.md](ATUALIZACAO.md).

## Requisitos
- Linux com Node.js **20 ou superior**, PostgreSQL 13+, Nginx.
- Espaço em disco para as imagens + lixeira (a lixeira guarda o que for excluído até ser purgado).

## 1. Banco de dados
```bash
sudo -u postgres psql -c "CREATE USER malagah WITH PASSWORD 'troque-esta-senha';"
sudo -u postgres psql -c "CREATE DATABASE malagah_imagens OWNER malagah;"
```

## 2. Aplicação
```bash
cd /var/www/malagah-imagens        # pasta do projeto
npm ci --omit=dev
cp .env.example .env
npm run admin:hash -- "senha-forte-do-admin"   # copie o hash para ADMIN_PASSWORD_HASH
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # cole em SESSION_SECRET
nano .env                           # preencha DATABASE_URL, BASE_URL etc.
npm run db:migrate
```

Em produção o servidor **não inicia** se `SESSION_SECRET` ou a senha do admin não estiverem configurados.

## 3. Processo (PM2)
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

## 4. Nginx
```nginx
server {
    server_name seu-dominio.com.br;
    client_max_body_size 80M;          # >= MAX_UPLOAD_MB × arquivos por envio

    # Opcional: Nginx servindo os arquivos diretamente (mais rápido).
    # Use o MESMO caminho de UPLOAD_ROOT e mantenha a pasta de lixeira fora daqui.
    # location /imagens/ {
    #     alias /var/www/malagah-imagens/public/imagens/;
    #     try_files $uri @app;           # cai no Node para /imagens/{referencia}
    #     disable_symlinks on;
    #     expires 30d;
    # }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;         # ZIPs grandes
    }
    # location @app { proxy_pass http://127.0.0.1:3000; ... mesmos headers ... }
}
```
Ative HTTPS (ex.: `certbot --nginx`) e use `COOKIE_SECURE=auto`.

## 5. Rotina recomendada (cron)
```cron
# Backup diário às 3h (ver BACKUP_E_ROLLBACK.md)
0 3 * * *  /var/www/malagah-imagens/scripts/backup.sh >> /var/log/malagah-backup.log 2>&1
# Purga da lixeira: itens com mais de 30 dias, todo domingo
30 4 * * 0 cd /var/www/malagah-imagens && npm run trash:purge -- --days 30
```

## 6. Testes (opcional, em servidor de homologação)
Os testes criam e apagam um banco temporário próprio (nome sempre contendo `test`), usam pastas temporárias e **ignoram o `.env`** — não tocam em dados reais.
```bash
npm ci
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test
```
O usuário de `TEST_DATABASE_URL` precisa da permissão `CREATEDB`.
