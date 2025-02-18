deps-layer:
	cd layers/deps/nodejs && npm install --only=prod

tsconfig:
	sed -i "s|__TSCONFIG_PATH__|"./tsconfig.json"|g" "${SAM_TEMPLATE}"
