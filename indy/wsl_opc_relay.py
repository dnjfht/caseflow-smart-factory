"""Forward OPC UA from the private WSL adapter to OIP's loopback-only server.

This is a development relay for a single Windows machine. It binds only the
WSL virtual adapter and never exposes the PLC endpoint on the external LAN.
"""
import argparse
import socket
import threading


def pipe(source, target):
    try:
        while chunk := source.recv(65536):
            target.sendall(chunk)
    except OSError:
        pass
    finally:
        try:
            target.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def forward(client):
    try:
        upstream = socket.create_connection(('127.0.0.1', 4843), timeout=5)
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    pipe(upstream, client)
    client.close()
    upstream.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', required=True, help='Windows WSL virtual adapter IPv4 address')
    args = parser.parse_args()
    with socket.create_server((args.bind, 4844), backlog=8) as server:
        print(f'WSL-only OPC relay listening on {args.bind}:4844', flush=True)
        while True:
            client, _ = server.accept()
            threading.Thread(target=forward, args=(client,), daemon=True).start()


if __name__ == '__main__':
    main()
