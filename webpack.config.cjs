// const path = require("path");

// module.exports = {
//     mode: "production",
//     entry: "./src/main.js", // Main entry point, will import other files
//     output: {
//         filename: "concgui.bundle.js", // Single bundled file
//         path: path.resolve(__dirname, "public/static/concgui"),
//         clean: true,
//     },
//     module: {
//         rules: [
//             {
//                 test: /\.css$/,
//                 use: ["style-loader", "css-loader"]
//             },
//             {
//                 test: /\.js$/,
//                 exclude: /node_modules/,
//                 use: {
//                     loader: "babel-loader",
//                     options: {
//                         presets: ["@babel/preset-env"]
//                     }
//                 }
//             }
//         ]
//     },
//     devServer: {
//         static: path.resolve(__dirname, "public"),
//         compress: true,
//         port: 8080,
//         open: true
//     }
// };

const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
    mode: "development",
    entry: "./src/main.js", // Main entry point
    output: {
        filename: "concgui.bundle.js",
        path: path.resolve(__dirname, "public/static/concgui"),
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader, 
                    "css-loader",
                    "postcss-loader" // Ensures Tailwind is processed correctly
                ],
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
    plugins: [
        new MiniCssExtractPlugin({
            filename: "../css/tailwind.css", // Extracts compiled Tailwind CSS
        })
    ],
    devServer: {
        static: path.resolve(__dirname, "public"),
        compress: true,
        port: 8080,
        open: true
    }
};