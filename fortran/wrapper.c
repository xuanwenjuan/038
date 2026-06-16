#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include <emscripten/val.h>

#ifdef __cplusplus
extern "C" {
#endif

extern void gravity_wave_param_(
    const int32_t* nlon, const int32_t* nlat, const int32_t* nlev,
    const double* wind_shear, const double* buoy_freq, const double* coriolis,
    double* u_field, double* v_field, double* w_field
);

#define NLON 32
#define NLAT 32
#define NLEV 20
#define GRID_SIZE (NLON * NLAT * NLEV)
#define FIELD_BYTES (GRID_SIZE * sizeof(double))

static double* g_u_field = NULL;
static double* g_v_field = NULL;
static double* g_w_field = NULL;
static uint8_t* g_byte_buffer = NULL;

EMSCRIPTEN_KEEPALIVE
int32_t wasm_init(void) {
    if (g_u_field) return 0;

    g_u_field = (double*)malloc(FIELD_BYTES);
    g_v_field = (double*)malloc(FIELD_BYTES);
    g_w_field = (double*)malloc(FIELD_BYTES);
    g_byte_buffer = (uint8_t*)malloc(FIELD_BYTES * 3);

    if (!g_u_field || !g_v_field || !g_w_field || !g_byte_buffer) {
        free(g_u_field); free(g_v_field); free(g_w_field); free(g_byte_buffer);
        g_u_field = g_v_field = g_w_field = NULL;
        g_byte_buffer = NULL;
        return -1;
    }

    memset(g_u_field, 0, FIELD_BYTES);
    memset(g_v_field, 0, FIELD_BYTES);
    memset(g_w_field, 0, FIELD_BYTES);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free(void) {
    free(g_u_field); free(g_v_field); free(g_w_field); free(g_byte_buffer);
    g_u_field = g_v_field = g_w_field = NULL;
    g_byte_buffer = NULL;
}

EMSCRIPTEN_KEEPALIVE
int32_t wasm_compute(double wind_shear, double buoy_freq, double coriolis) {
    if (!g_u_field) return -1;

    int32_t nlon = NLON, nlat = NLAT, nlev = NLEV;
    double ws = wind_shear, bf = buoy_freq, co = coriolis;

    gravity_wave_param_(&nlon, &nlat, &nlev, &ws, &bf, &co,
                        g_u_field, g_v_field, g_w_field);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_get_u8_ptr(void) {
    return g_byte_buffer;
}

EMSCRIPTEN_KEEPALIVE
int32_t wasm_serialize_fields(void) {
    if (!g_byte_buffer || !g_u_field) return -1;
    memcpy(g_byte_buffer,                    g_u_field, FIELD_BYTES);
    memcpy(g_byte_buffer + FIELD_BYTES,      g_v_field, FIELD_BYTES);
    memcpy(g_byte_buffer + FIELD_BYTES * 2,  g_w_field, FIELD_BYTES);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_grid_size(void)      { return GRID_SIZE; }
EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_field_bytes(void)    { return FIELD_BYTES; }
EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_total_bytes(void)    { return FIELD_BYTES * 3; }
EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_nlon(void)           { return NLON; }
EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_nlat(void)           { return NLAT; }
EMSCRIPTEN_KEEPALIVE
int32_t wasm_get_nlev(void)           { return NLEV; }

EMSCRIPTEN_KEEPALIVE
int32_t wasm_validate(void) {
    if (!g_u_field) return 0;
    int32_t non_zero = 0;
    for (int32_t i = 0; i < GRID_SIZE; i++) {
        if (g_u_field[i] != 0.0 || g_v_field[i] != 0.0 || g_w_field[i] != 0.0) {
            non_zero++;
        }
    }
    return non_zero;
}

#ifdef __cplusplus
}
#endif
