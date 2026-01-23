#!/bin/bash
set -e

# OpenVPN container startup script with automatic PKI initialization
# This script ensures PKI is initialized once when the container starts

echo "=== OpenVPN Container Startup ==="

# Ensure server config exists
if [ ! -f /etc/openvpn/openvpn.conf ]; then
    echo "OpenVPN config missing, generating..."
    ovpn_genconfig -u udp://openvpn
fi

# Ensure auth directory and script exist
mkdir -p /etc/openvpn/auth
if [ ! -f /etc/openvpn/auth/credentials ]; then
    touch /etc/openvpn/auth/credentials
fi
if [ ! -f /etc/openvpn/auth/validate.sh ]; then
    cat <<'EOF' >/etc/openvpn/auth/validate.sh
#!/bin/sh
USER="$(head -n 1 "$1" | tr -d '\r')"
PASS="$(sed -n '2p' "$1" | tr -d '\r')"
[ -z "$USER" ] && exit 1
[ -z "$PASS" ] && exit 1
grep -Fqx "${USER}:${PASS}" /etc/openvpn/auth/credentials
EOF
    chmod 700 /etc/openvpn/auth/validate.sh
fi

# Ensure auth-user-pass verification is configured
if ! grep -q "^auth-user-pass-verify" /etc/openvpn/openvpn.conf; then
    echo "auth-user-pass-verify /etc/openvpn/auth/validate.sh via-file" >> /etc/openvpn/openvpn.conf
    echo "script-security 3" >> /etc/openvpn/openvpn.conf
fi

# Check if PKI is fully initialized by looking for key files
if [ -f /etc/openvpn/pki/ca.crt ] && [ -f /etc/openvpn/pki/dh.pem ]; then
    echo "OpenVPN PKI already fully initialized, skipping setup..."
else
    echo "OpenVPN PKI incomplete or not found, initializing..."

    # Remove incomplete PKI directory if it exists
    if [ -d /etc/openvpn/pki ]; then
        echo "Removing incomplete PKI directory..."
        rm -rf /etc/openvpn/pki
    fi

    # Initialize PKI with no passphrase (non-interactive)
    # Pipe empty input to answer the CA Common Name prompt with default
    echo "Running ovpn_initpki with nopass..."
    echo "" | ovpn_initpki nopass

    echo "OpenVPN PKI initialized successfully!"
fi

echo "=== OpenVPN Ready ==="
echo "PKI is ready for client profile generation."
echo "Starting OpenVPN server..."
exec openvpn --config /etc/openvpn/openvpn.conf
