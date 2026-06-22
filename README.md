# Repositório de imagens Stylezee

Sistema web para administrar coleções, produtos/referências e imagens, com página pública em:

```txt
https://stylezee.com.br/imagens/{referencia}
```

O sistema não gera QR Code. Ele apenas atende a URL já gravada nas etiquetas.

## Recursos

- Painel administrativo com login.
- Cadastro de coleções ativas/inativas.
- Cadastro de produtos por referência única.
- Upload múltiplo de JPG, PNG e WEBP.
- Organização dos arquivos em `/imagens/{colecao}/{referencia}/arquivo`.
- Definição de imagem principal, exclusão e reordenação.
- Importação em massa por nome de arquivo.
- Página pública mobile-first com galeria e tela cheia.
- PostgreSQL como banco de dados.

## Instalação local

```bash
npm install
cp .env.example .env
npm run admin:hash -- "sua senha"
```

Copie o hash gerado para `ADMIN_PASSWORD_HASH` no `.env`.

Crie o banco PostgreSQL e rode:

```bash
export DATABASE_URL="postgres://usuario:senha@localhost:5432/stylezee_imagens"
npm run db:migrate
npm start
```

Acesse:

```txt
http://localhost:3000/admin
```

## Deploy em servidor Linux

1. Instale Node.js 20+, PostgreSQL e Nginx.
2. Crie o banco e usuário PostgreSQL.
3. Copie o projeto para o servidor.
4. Configure o `.env` com `BASE_URL=https://stylezee.com.br`.
5. Rode `npm install --omit=dev`.
6. Rode `npm run db:migrate`.
7. Inicie o app com PM2 ou systemd.
8. Configure o Nginx como proxy reverso para a porta do app.

Se estiver testando por IP ou por `http://`, use `COOKIE_SECURE=false` no `.env`. Em produção com HTTPS, use `COOKIE_SECURE=auto`.

Com PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Exemplo Nginx:

```nginx
server {
    server_name stylezee.com.br;

    client_max_body_size 80M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Importação em massa

Na tela de upload, os arquivos podem ser vinculados pela referência no início do nome:

```txt
217.0010VT_01.jpg
217.0010VT_02.webp
```

O painel permite escolher o separador usado no nome do arquivo.
