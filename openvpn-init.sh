#!/bin/bash
set -e

# OpenVPN container startup script with automatic PKI initialization
# This script ensures PKI is initialized once when the container starts

echo "=== OpenVPN Container Startup ==="

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
    
    # Generate OpenVPN config (non-interactive)
    echo "Running ovpn_genconfig..."
    ovpn_genconfig -u udp://openvpn
    
    # Initialize PKI with no passphrase (non-interactive)
    echo "Running ovpn_initpki with nopass..."
    ovpn_initpki nopass
    
    echo "OpenVPN PKI initialized successfully!"
fi

echo "=== OpenVPN Ready ==="

# Execute the original entrypoint command
# The kylemanna/openvpn image expects to run OpenVPN server by default
exec openvpn --config /etc/openvpn/openvpn.conf
