const path = require("path");

module.exports = {
    mode: "production",
    entry: "./src/main.js", // Main entry point, will import other files
    output: {
        filename: "concgui.bundle.js", // Single bundled file
        path: path.resolve(__dirname, "public/static/concgui"),
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"]
            },
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-env"]
                    }
                }
            }
        ]
    },
    devServer: {
        static: path.resolve(__dirname, "public"),
        compress: true,
        port: 8080,
        open: true
    }
};