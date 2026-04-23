#!/bin/bash
set -e

# === IziPilot — Obtention certificat SSL Let's Encrypt ===
# À exécuter UNE SEULE FOIS lors du premier déploiement
# Prérequis: le DNS du domaine doit pointer vers l'IP du VPS

echo "=== IziPilot — Init SSL ==="

if [ ! -f .env.production ]; then
  echo "ERREUR: .env.production introuvable."
  exit 1
fi

set -a
source .env.production
set +a

if [ -z "$DOMAIN" ]; then
  echo "ERREUR: DOMAIN non défini dans .env.production"
  exit 1
fi

EMAIL="${SSL_EMAIL:-admin@izichange.com}"

echo "Domaine: $DOMAIN"
echo "Email: $EMAIL"

# Étape 1 — Démarrer avec la config HTTP-only
echo ""
echo "1/4 — Config Nginx temporaire (HTTP only)..."
envsubst '${DOMAIN}' < nginx/templates/izipilot-init.conf > nginx/conf.d/default.conf
rm -f nginx/conf.d/izipilot.conf.active

docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx app db

echo "Attente démarrage Nginx..."
sleep 5

# Étape 2 — Obtenir le certificat
echo ""
echo "2/4 — Obtention du certificat Let's Encrypt..."
docker compose -f docker-compose.prod.yml run --rm certbot \
  certbot certonly --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --force-renewal

# Étape 3 — Passer en config HTTPS
echo ""
echo "3/4 — Activation config HTTPS..."
envsubst '${DOMAIN}' < nginx/templates/izipilot.conf > nginx/conf.d/default.conf

# Étape 4 — Redémarrer Nginx
echo ""
echo "4/4 — Redémarrage Nginx avec SSL..."
docker compose -f docker-compose.prod.yml restart nginx

echo ""
echo "=== SSL configuré avec succès ==="
echo "Site accessible sur: https://$DOMAIN"
echo "Le renouvellement est automatique (certbot container)."
