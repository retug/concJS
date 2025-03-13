// module.exports = {
//     plugins: {
//       "@tailwindcss/postcss": {},
//     },
//   };

module.exports = {
  plugins: [
    require("@tailwindcss/postcss"),
    require("autoprefixer"),
  ],
};