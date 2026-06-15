# 🛡️ Guía de Configuración: MongoDB Replica Set en Docker Compose

Esta guía (opcional para entornos no críticos o de desarrollo) describe cómo configurar e implementar un clúster de alta disponibilidad de MongoDB (1 Nodo Primario + 2 Nodos Secundarios) mediante un Replica Set (`rs0`) con failover automático.

---

## 1. Configuración de Servicios (`docker-compose.yml`)

Para activar el Replica Set, debemos instanciar tres servicios independientes de MongoDB ejecutando el comando `--replSet rs0`:

```yaml
version: '3.8'

services:
  # Nodo Primario Inicial
  mongodb1:
    image: mongo:8.0
    container_name: bitacora-mongodb1
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo1_data:/data/db
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=secreto_root
    networks:
      - soc-network

  # Nodo Secundario 1
  mongodb2:
    image: mongo:8.0
    container_name: bitacora-mongodb2
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27018:27017"
    volumes:
      - mongo2_data:/data/db
    networks:
      - soc-network

  # Nodo Secundario 2
  mongodb3:
    image: mongo:8.0
    container_name: bitacora-mongodb3
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27019:27017"
    volumes:
      - mongo3_data:/data/db
    networks:
      - soc-network

volumes:
  mongo1_data:
  mongo2_data:
  mongo3_data:

networks:
  soc-network:
    driver: bridge
```

---

## 2. Inicialización del Replica Set

Una vez que los tres contenedores estén en estado activo, se debe iniciar el Replica Set ingresando al shell de base de datos del contenedor primario:

```bash
docker exec -it bitacora-mongodb1 mongosh -u admin -p secreto_root --eval '
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongodb1:27017" },
      { _id: 1, host: "mongodb2:27017" },
      { _id: 2, host: "mongodb3:27017" }
    ]
  })
'
```

Para verificar que la réplica se haya sincronizado correctamente y ver los roles (PRIMARY y SECONDARY) de cada nodo:

```bash
docker exec -it bitacora-mongodb1 mongosh -u admin -p secreto_root --eval "rs.status()"
```

---

## 3. Cadena de Conexión en el Backend (`.env`)

Para que el backend aproveche el failover automático en caliente, se debe actualizar la URI de conexión en el archivo `.env` de la raíz del proyecto para listar a todos los miembros de la réplica:

```env
# Comentario: URI de conexión configurada para conectarse al Replica Set de MongoDB con failover automático transparente.
MONGO_URI=mongodb://admin:secreto_root@mongodb1:27017,mongodb2:27017,mongodb3:27017/bitacora?replicaSet=rs0&authSource=admin
```

El driver nativo de Node.js se encargará de redirigir en caliente las consultas de lectura y escritura al nuevo nodo primario en caso de que ocurran pérdidas de conectividad o caídas del nodo principal, sin requerir reinicios de la aplicación.
