#!/bin/bash
set -e

# === IziPilot — Setup initial du VPS Hostinger ===
# À exécuter en root sur un VPS Ubuntu 22.04/24.04 fraîchement provisionné

echo "=== IziPilot — Setup VPS ==="

# Mise à jour système
echo "1/5 — Mise à jour système..."
apt update && apt upgrade -y

# Install Docker
echo "2/5 — Installation Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installé."
else
  echo "Docker déjà installé."
fi

# Install Docker Compose plugin
echo "3/5 — Vérification Docker Compose..."
if ! docker compose version &> /dev/null; then
  apt install -y docker-compose-plugin
fi
docker compose version

# Firewall
echo "4/5 — Configuration firewall..."
apt install -y ufw
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "Firewall configuré (22, 80, 443)."

# Clone du repo
echo "5/5 — Prêt pour le déploiement."
echo ""
echo "=== Prochaines étapes ==="
echo ""
echo "1. Cloner le repo:"
echo "   git clone https://github.com/obamg/izipilot.git"
echo "   cd izipilot"
echo ""
echo "2. Configurer les variables:"
echo "   cp .env.production.example .env.production"
echo "   nano .env.production"
echo ""
echo "3. Générer les secrets:"
echo "   openssl rand -base64 64   # → NEXTAUTH_SECRET"
echo "   openssl rand -base64 64   # → CRON_SECRET"
echo "   openssl rand -base64 32   # → POSTGRES_PASSWORD"
echo ""
echo "4. Pointer le DNS vers cette IP:"
echo "   IP du serveur: $(curl -s ifconfig.me)"
echo ""
echo "5. Obtenir le certificat SSL:"
echo "   chmod +x scripts/*.sh"
echo "   ./scripts/init-ssl.sh"
echo ""
echo "6. Déployer:"
echo "   ./scripts/deploy.sh"
echo ""
echo "7. Seeder la base de données:"
echo "   docker compose -f docker-compose.prod.yml exec app npx prisma db seed"
