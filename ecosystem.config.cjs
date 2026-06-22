module.exports = {
  apps: [
    {
      name: 'stylezee-imagens',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
