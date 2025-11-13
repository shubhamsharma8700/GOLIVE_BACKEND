import app from "./src/app.js";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

dotenv.config();

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Admin Event API",
      version: "1.0.0",
      description: "API documentation for admin login and event management",
    },
    servers: [
       {
        url: "http://localhost:5000",
        description: "Local server",
      },
      {
         url: "https://d2wmdj5cojtj0q.cloudfront.net/app",
         description: "Production server",
      }
    ],
  },
  apis: ["./src/routes/*.js"], // ✅ correct path for your folder structure
};


const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.get('/health', (req, res) => res.status(200).send('OK'));


const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
