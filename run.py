from flask import Flask, render_template

# Указываем, где лежат шаблоны и статика
app = Flask(
    __name__, 
    template_folder="app/templates", 
    static_folder="app/static"
)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/dashboard')
def dashboard():
    return "<h1>Дашборд</h1>"

@app.route('/gallery')
def gallery():
    return "<h1>Галерея</h1>"

@app.route('/about')
def about():
    return "<h1>О клане</h1>"

if __name__ == "__main__":
    app.run(debug=True)
