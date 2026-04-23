#!/bin/sh
set -e

env > /etc/cron.env

crond -f -l 2
