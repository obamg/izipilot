#!/bin/bash
set -e

# === IziPilot — Script de déploiement VPS Hostinger ===
# Usage: ./scripts/deploy.sh

echo "=== IziPilot — Déploiement Production ==="

# Vérifier .env.production
if [ ! -f .env.production ]; then
  echo "ERREUR: .env.production introuvable."
  echo "Copier .env.production.example → .env.production et remplir les valeurs."
  exit 1
fi

# Charger les variables
set -a
source .env.production
set +a

# Vérifier les variables critiques
for var in DOMAIN POSTGRES_PASSWORD NEXTAUTH_SECRET CRON_SECRET; do
  if [ -z "${!var}" ] || [[ "${!var}" == *"CHANGE_ME"* ]]; then
    echo "ERREUR: $var n'est pas configuré dans .env.production"
    exit 1
  fi
done

echo "Domaine: $DOMAIN"

# Substituer les variables dans la config nginx (Cloudflare + self-signed cert)
echo "Configuration Nginx (Cloudflare Full SSL)..."
envsubst '${DOMAIN}' < nginx/templates/izipilot-cloudflare.conf > nginx/conf.d/default.conf

# Build et démarrage
echo "Build de l'image Docker..."
docker compose -f docker-compose.prod.yml --env-file .env.production build

echo "Démarrage des services..."
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

echo ""
echo "=== Déploiement terminé ==="
echo "App: https://$DOMAIN"
echo ""
echo "Commandes utiles:"
echo "  Logs:    docker compose -f docker-compose.prod.yml logs -f app"
echo "  Status:  docker compose -f docker-compose.prod.yml ps"
echo "  Seed DB: docker compose -f docker-compose.prod.yml exec app npx prisma db seed"
echo "  Restart: docker compose -f docker-compose.prod.yml restart app"
