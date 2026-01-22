#!/bin/bash
set -e

# OpenVPN container startup script with automatic PKI initialization
# This script ensures PKI is initialized once when the container starts

echo "=== OpenVPN Container Startup ==="

# Check if PKI is already initialized
if [ -d /etc/openvpn/pki ]; then
    echo "OpenVPN PKI already initialized, skipping setup..."
else
    echo "OpenVPN PKI not found, initializing..."
    
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
