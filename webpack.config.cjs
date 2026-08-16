const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
    mode: "production",
    entry: "./src/main.js",

    output: {
        filename: "concgui.bundle.js",
        path: path.resolve(__dirname, "public/static/concgui"),
        clean: true,
        publicPath: "auto",
        assetModuleFilename: "[name][ext]",
    },

    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    "css-loader",
                    "postcss-loader",
                ],
            },
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-env"],
                    },
                },
            },

            // Required because main.js imports static/disc.png.
            {
                test: /\.(png|jpg|jpeg|gif|svg)$/i,
                type: "asset/resource",
                generator: {
                    filename: "[name][ext]",
                },
            },
        ],
    },

    plugins: [
        new MiniCssExtractPlugin({
            filename: "../css/tailwind.css",
        }),
    ],
};
