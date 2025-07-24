import coursesData from './courses_data.js';

export const getCourses = async (req, res) => {
    try {
        // Aquí puedes agregar lógica para leer de una base de datos si es necesario
        // Por ahora, simplemente devolvemos los datos del archivo
        const courses = coursesData.map(course => ({
            id: course.id,
            title: course.title,
            shortDescription: course.shortDescription,
            longDescription: course.longDescription,
            imageUrl: course.imageUrl,
            // Condicionalmente incluir videoUrl si existe
            ...(course.videoUrl && { videoUrl: course.videoUrl }),
            price: course.price,
        }));

        res.status(200).json(courses);
    } catch (error) {
        console.error("Error al obtener los cursos:", error);
        res.status(500).json({ message: "Error al obtener los cursos" });
    }
};