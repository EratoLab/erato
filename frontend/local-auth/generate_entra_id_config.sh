#!/bin/bash

echo "Generating oauth2-proxy config for Entra ID..."

read -p "Enter Tenant ID: " tenant_id
read -p "Enter Client ID: " client_id
read -p "Enter Client Secret: " client_secret
cookie_secret=$(openssl rand -base64 32)

template_file="oauth2-proxy-entra-id.template.cfg"
output_file="oauth2-proxy-entra-id.cfg"

if [ ! -f "$template_file" ]; then
    echo "Template file $template_file not found!"
    exit 1
fi

sed -e "s/{{TENANT_ID}}/$tenant_id/g" \
    -e "s/{{CLIENT_ID}}/$client_id/g" \
    -e "s/{{CLIENT_SECRET}}/$client_secret/g" \
    -e "s/{{COOKIE_SECRET}}/$cookie_secret/g" \
    "$template_file" > "$output_file"

chmod 600 "$output_file"

echo "Generated $output_file with your configuration" 