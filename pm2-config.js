module.exports = {
  apps: [
    {
      name: "Telegram uploader",
      script: "./index.js",
      watch: true,
      instance_var: 'INSTANCE_ID',
      env: {
        "NTBA_FIX_350": 1
      }
    }
  ]
}
