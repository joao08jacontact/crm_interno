module.exports = {
  apps: [
    {
      name: "inova-analise",
      script: "dist/index.cjs",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // Reinicia automaticamente se o processo morrer
      autorestart: true,
      // Reinicia se usar mais de 500MB de RAM
      max_memory_restart: "500M",
      // Salva logs em arquivos
      error_file: "./logs/pm2-error.log",
      out_file:   "./logs/pm2-out.log",
      merge_logs: true,
      // Não reinicia mais do que 10x em 1 minuto (evita loop de crash)
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
