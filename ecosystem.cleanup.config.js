module.exports = {
  apps: [{
    "name": "groupdeedo-cleanup",
    "script": "/home/ec2-user/webapp/groupdeedo/scripts/cleanup.js",
    "args": "--live --cron",
    "cron_restart": "0 3 * * *",
    "autorestart": false,
    "watch": false,
    "env": {
        "NODE_ENV": "production"
    }
}]
};