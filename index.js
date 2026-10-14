require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Función para calcular distancia en KM
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

// 1. OBTENER SOLICITUDES PENDIENTES
app.get('/api/solicitudes', async (req, res) => {
  try {
    const latMedico = parseFloat(req.query.lat) || -24.7859;
    const lngMedico = parseFloat(req.query.lng) || -65.4117;

    const result = await pool.query(`SELECT * FROM solicitudes_guardia WHERE estado = 'PENDIENTE' ORDER BY creado_en DESC`);

    const solicitudes = result.rows.map((row) => ({
      ...row,
      distancia_km: calcularDistanciaKm(latMedico, lngMedico, row.latitud, row.longitud),
    }));
    res.json(solicitudes);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// 2. CREAR NUEVA SOLICITUD (Ahora guarda el paciente_id)
app.post('/api/solicitudes', async (req, res) => {
  try {
    const {
      paciente_id, nombre_paciente, telefono_paciente, para_quien, domicilio, referencias_casa, barrio, horario, motivo, observaciones_sintomas, metodo_pago, precio, latitud, longitud
    } = req.body;

    const result = await pool.query(
      `INSERT INTO solicitudes_guardia 
      (paciente_id, nombre_paciente, telefono_paciente, para_quien, domicilio, referencias_casa, barrio, horario, motivo, observaciones_sintomas, metodo_pago, precio, latitud, longitud)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [paciente_id, nombre_paciente, telefono_paciente, para_quien, domicilio, referencias_casa, barrio, horario, motivo, observaciones_sintomas, metodo_pago, precio || 30000, latitud, longitud]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo guardar la solicitud' });
  }
});

// 3. CONSULTAR ESTADO DE UNA SOLICITUD ESPECÍFICA
app.get('/api/solicitudes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM solicitudes_guardia WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar solicitud' });
  }
});

// 4. ACTUALIZAR ESTADO (Ahora registra qué médico aceptó la visita)
app.patch('/api/solicitudes/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, diagnostico_medico, medico_id, medico_nombre } = req.body;

    const result = await pool.query(
      `UPDATE solicitudes_guardia 
       SET estado = $1, 
           diagnostico_medico = COALESCE($2, diagnostico_medico),
           medico_id = COALESCE($3, medico_id),
           medico_nombre = COALESCE($4, medico_nombre)
       WHERE id = $5 
       RETURNING *`,
      [estado, diagnostico_medico, medico_id, medico_nombre, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo actualizar la visita' });
  }
});

// 5. OBTENER HISTORIAL FILTRADO POR USUARIO (El cambio clave)
app.get('/api/historial', async (req, res) => {
  try {
    const { usuario_id, rol } = req.query;
    let query = `SELECT * FROM solicitudes_guardia ORDER BY creado_en DESC LIMIT 50`;
    let params = [];

    // Si pasamos el ID, filtramos para que cada uno vea solo lo suyo
    if (usuario_id && rol) {
      if (rol === 'MEDICO') {
        query = `SELECT * FROM solicitudes_guardia WHERE medico_id = $1 ORDER BY creado_en DESC`;
      } else {
        query = `SELECT * FROM solicitudes_guardia WHERE paciente_id = $1 ORDER BY creado_en DESC`;
      }
      params = [usuario_id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar el historial' });
  }
});

// 6. REGISTRO DE USUARIOS
app.post('/api/registro', async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono, matricula, especialidad, alias_cbu } = req.body;
    const result = await pool.query(
      `INSERT INTO usuarios (nombre, email, password, rol, telefono, matricula, especialidad, alias_cbu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nombre, email, password, rol, telefono, matricula, especialidad, alias_cbu]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'El email ya existe o hubo un error' });
  }
});

// 7. LOGIN DE USUARIOS
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(401).json({ error: 'Credenciales incorrectas' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor DomiGuardia corriendo en el puerto ${PORT}`);
});