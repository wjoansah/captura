deps-layer:
	cd layers/deps/nodejs && npm install --only=prod

tsconfig:
	sed -i "s|__TSCONFIG_PATH__|$(printf '%s\n' "${CODEBUILD_SRC_DIR}/src/tsconfig.json" | sed 's/[\/&]/\\&/g')|g" "${SAM_TEMPLATE}"
