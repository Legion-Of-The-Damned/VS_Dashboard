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
    return render_template('dashboard.html')

@app.route('/kv-map')
def kv_map():
    return render_template('kv-map.html')

@app.route('/about')
def about():
    return render_template('about.html')

if __name__ == "__main__":
    app.run(debug=True)
