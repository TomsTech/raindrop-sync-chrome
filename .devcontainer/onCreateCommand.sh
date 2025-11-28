#!/usr/bin/env bash

# dotenvx
curl -sfS https://dotenvx.sh | sudo sh

sudo chown -R "$(id -u):$(id -g)" ~/.config/google-chrome
