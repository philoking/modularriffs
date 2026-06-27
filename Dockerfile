# Modular Riffs — static app served over plain HTTP by Caddy.
# TLS is terminated upstream by your reverse proxy, which also handles the
# domain + Let's Encrypt cert. The container just serves files.
FROM caddy:2-alpine
COPY index.html styles.css /srv/
COPY js/ /srv/js/
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 7000
