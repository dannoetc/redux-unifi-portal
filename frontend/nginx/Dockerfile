FROM nginx:1.25-alpine
RUN apk add --no-cache openssl gettext
RUN rm -f /etc/nginx/conf.d/default.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
