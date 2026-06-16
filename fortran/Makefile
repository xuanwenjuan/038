FC = gfortran
CC = emcc
AR = emar

SRC_DIR = .
BUILD_DIR = ../build/wasm
FRONTEND_PUBLIC_DIR = ../frontend/public/wasm

FFLAGS = -O2 -fdefault-real-8 -fdefault-double-8 -Wall
EMCFLAGS = -O2 -Wall -s WASM=1 -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue", "UTF8ToString", "stringToUTF8", "lengthBytesUTF8"]'
EMCFLAGS += -s EXPORTED_FUNCTIONS='["_main", "_wasm_init", "_wasm_free", "_wasm_compute", "_wasm_get_u8_ptr", "_wasm_serialize_fields", "_wasm_get_grid_size", "_wasm_get_field_bytes", "_wasm_get_total_bytes", "_wasm_get_nlon", "_wasm_get_nlat", "_wasm_get_nlev", "_wasm_validate", "malloc", "free"]'
EMCFLAGS += -s ALLOW_MEMORY_GROWTH=1
EMCFLAGS += -s MODULARIZE=1 -s EXPORT_ES6=1
EMCFLAGS += -s MAXIMUM_MEMORY=512MB
EMCFLAGS += -s INITIAL_MEMORY=64MB

FORTRAN_OBJS = $(BUILD_DIR)/gravity_wave_model.o
C_OBJS = $(BUILD_DIR)/wrapper.o
LIBFORTRAN = $(BUILD_DIR)/libgravity_wave.a

TARGET = $(FRONTEND_PUBLIC_DIR)/gravityWaveModel.js
TARGET_WASM = $(FRONTEND_PUBLIC_DIR)/gravityWaveModel.wasm

.PHONY: all dirs clean

all: dirs $(TARGET)

dirs:
	@mkdir -p $(BUILD_DIR)
	@mkdir -p $(FRONTEND_PUBLIC_DIR)

$(BUILD_DIR)/gravity_wave_model.o: $(SRC_DIR)/gravity_wave_model.f
	$(FC) $(FFLAGS) -c $< -o $@

$(BUILD_DIR)/wrapper.o: $(SRC_DIR)/wrapper.c
	$(CC) $(EMCFLAGS) -c $< -o $@

$(LIBFORTRAN): $(FORTRAN_OBJS)
	$(AR) rcs $@ $^

$(TARGET): $(C_OBJS) $(LIBFORTRAN)
	$(CC) $(EMCFLAGS) $(C_OBJS) -L$(BUILD_DIR) -lgravity_wave -lfortran -o $@
	@echo "Built WASM module at $(TARGET)"

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(TARGET) $(TARGET_WASM)
