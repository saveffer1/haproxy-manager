FROM haproxy:3.3-alpine

RUN apk add --no-cache logrotate

COPY ./haproxy/logrotate.cfg /etc/logrotate.d/haproxy

# Run logrotate daily for HAProxy file logs
RUN mkdir -p /var/lib/logrotate \
    && printf "0 0 * * * /usr/sbin/logrotate -s /var/lib/logrotate/haproxy.status /etc/logrotate.d/haproxy\n" > /etc/crontabs/root
