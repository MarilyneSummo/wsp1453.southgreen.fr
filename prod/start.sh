#!/bin/bash
export NVM_DIR="/root/.nvm"
. "$NVM_DIR/nvm.sh"
cd /opt/www/wsp1453.southgreen.fr/prod
exec npm run server